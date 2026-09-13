import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppConfig, timingSafeCompare } from '../config.js';
import { getClient } from '../discord.js';
import { createMcpServer } from '../server.js';

interface ActiveSession {
  sessionId: string;
  transport: SSEServerTransport;
  server: ReturnType<typeof createMcpServer>;
  keepAliveTimer: NodeJS.Timeout;
  createdAt: Date;
}

export async function runSseServer(config: AppConfig): Promise<void> {
  const app = express();

  // Trust Cloudflare reverse proxy headers
  app.set('trust proxy', 1);

  // Validate security configuration - zero hardcoded credentials
  if (!config.authToken) {
    throw new Error(
      '[Security Configuration Error] MCP_AUTH_TOKEN must be set in process.env or .env. ' +
      'Refusing to start unauthenticated remote MCP server.'
    );
  }

  // Rate limiting to prevent brute-force token attacks and DoS
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 180, // Max 180 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down your requests.'
    }
  });
  app.use(limiter);

  // Parse JSON payloads for POST messages (maximum payload 4MB)
  app.use(
    express.json({
      limit: '4mb',
      type: ['application/json', 'application/*+json', 'text/plain']
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Comprehensive HTTP request logger with secret token masking
  app.use((req, _res, next) => {
    const rawUrl = req.originalUrl || req.url;
    const sanitizedUrl = rawUrl.replace(/([?&]token=)([^&]+)/gi, (_match, prefix, val) => {
      if (val.length <= 8) return `${prefix}***`;
      return `${prefix}${val.slice(0, 4)}...${val.slice(-4)}`;
    });
    const rpcInfo = req.body?.method ? ` [JSON-RPC: ${req.body.method}]` : '';
    console.error(`[HTTP-REQ] ${req.method} ${sanitizedUrl}${rpcInfo}`);
    next();
  });

  // CORS configured with explicit allowed headers and methods
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS', 'HEAD', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'X-Session-ID',
        'mcp-session-id',
        'Mcp-Session-Id'
      ],
      exposedHeaders: ['X-Session-ID', 'mcp-session-id', 'Mcp-Session-Id', 'Content-Type']
    })
  );

  // Normalize Accept header to ensure Streamable HTTP SDK compatibility
  // (Prevents 406 Not Acceptable when clients omit text/event-stream)
  app.use((req, _res, next) => {
    if (
      !req.headers.accept ||
      !req.headers.accept.includes('text/event-stream') ||
      !req.headers.accept.includes('application/json')
    ) {
      req.headers.accept = 'application/json, text/event-stream';
    }
    next();
  });

  // Active sessions registry: sessionId -> ActiveSession
  const sessions = new Map<string, ActiveSession>();

  // =========================================================================
  // Security & Authentication Middleware
  // =========================================================================
  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    let candidateToken: string | undefined;

    // 1. Extract from HTTP Authorization header (Bearer <TOKEN>)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      candidateToken = authHeader.substring(7).trim();
    }

    // 2. Fallback to URL query parameter (?token=<TOKEN>)
    if (!candidateToken && req.query.token && typeof req.query.token === 'string') {
      candidateToken = req.query.token.trim();
    }

    // 3. Constant-time timing-safe validation against configured environment token
    if (!candidateToken || !timingSafeCompare(candidateToken, config.authToken)) {
      res.status(401).json({
        error: 'Unauthorized',
        message:
          'Invalid or missing authentication token. Provide via Authorization: Bearer <TOKEN> header or ?token=<TOKEN> query parameter.'
      });
      return;
    }

    next();
  };

  // Helper to extract absolute URL base (handles Cloudflare Tunnel, Nginx, or direct)
  const resolveBaseUrl = (req: Request): string => {
    const host = req.headers['x-forwarded-host'] || req.headers.host || `${config.host}:${config.port}`;
    let proto = req.headers['x-forwarded-proto'] || (req.socket && (req.socket as any).encrypted ? 'https' : 'http');
    // If proxied over Cloudflare Tunnel or standard SSL reverse proxy
    if (
      typeof host === 'string' &&
      (host.includes('trycloudflare.com') || host.includes('lhr.life') || req.headers['cf-ray'])
    ) {
      proto = 'https';
    }
    return `${proto}://${host}`;
  };

  // =========================================================================
  // Reachability Probes (Instant HTTP HEAD response for any route)
  // =========================================================================
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(200).end();
      return;
    }
    next();
  });

  // =========================================================================
  // RFC 9470: OAuth 2.0 Protected Resource Metadata Discovery
  // Unauthenticated per RFC 9470 so remote MCP clients (e.g. Gemini Spark) can probe
  // =========================================================================
  app.use('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
    const baseUrl = resolveBaseUrl(req);
    res.setHeader('Content-Type', 'application/json');
    res.json({
      resource: baseUrl,
      authorization_servers: [],
      bearer_methods_supported: ['header', 'query'],
      resource_documentation: `${baseUrl}/`
    });
  });

  // =========================================================================
  // Health & Diagnostic Endpoint (Unauthenticated for Tunnel & Cloud Probes)
  // =========================================================================
  app.get('/health', (_req: Request, res: Response) => {
    try {
      const client = getClient();
      res.json({
        status: 'healthy',
        activeSessions: sessions.size,
        uptimeSeconds: Math.floor(process.uptime()),
        discord: {
          ready: client.isReady(),
          user: client.user?.tag || null,
          guildsCount: client.guilds.cache.size
        }
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        activeSessions: sessions.size,
        uptimeSeconds: Math.floor(process.uptime()),
        error: err.message
      });
    }
  });

  // =========================================================================
  // MCP Remote SSE Transport Handler (GET /sse and GET /mcp)
  // =========================================================================
  const handleSseConnection = async (req: Request, res: Response): Promise<void> => {
    const baseUrl = resolveBaseUrl(req);

    // 1. Cloudflare Tunnel & Reverse Proxy Anti-Buffering Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Handle HTTP HEAD probe requests immediately
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    // Hook write to rewrite relative endpoint event into absolute URL
    // Guarantees remote clients (e.g. web-based Spark) post back to the tunnel with auth token
    const originalWrite = res.write.bind(res);
    res.write = function (chunk: any, encoding?: any, cb?: any): boolean {
      let str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
      if (str && str.includes('event: endpoint\ndata: ')) {
        const tokenQuery = req.query.token ? `token=${encodeURIComponent(String(req.query.token))}&` : '';
        str = str.replace(/data:\s*\/messages\?/, `data: ${baseUrl}/messages?${tokenQuery}`);
        str = str.replace(/data:\s*\/message\?/, `data: ${baseUrl}/message?${tokenQuery}`);
        chunk = typeof chunk === 'string' ? str : Buffer.from(str, 'utf8');
      }
      return originalWrite(chunk, encoding, cb);
    };

    // Instantiate official MCP SDK SSE Transport
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    const server = createMcpServer(config);

    // 2. Active Heartbeat / Keep-Alive mechanism (every 15s)
    // Prevents Cloudflare Tunnel HTTP 524 Idle Timeout
    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(': keep-alive\n\n');
        } catch (writeErr) {
          console.error(`[SSE] Heartbeat failed for session ${sessionId}:`, writeErr);
          disposeSession('heartbeat_failure');
        }
      }
    }, 15000);

    // Register active session
    const sessionObj: ActiveSession = {
      sessionId,
      transport,
      server,
      keepAliveTimer,
      createdAt: new Date()
    };
    sessions.set(sessionId, sessionObj);
    console.error(`[SSE] Session initialized: ${sessionId} (Active: ${sessions.size})`);

    // 3. Clean Session Lifecycle Management
    let isDisposed = false;
    const disposeSession = async (reason: string) => {
      if (isDisposed) return;
      isDisposed = true;

      clearInterval(keepAliveTimer);
      sessions.delete(sessionId);

      try {
        await server.close();
      } catch (closeErr) {
        // safe server close
      }

      console.error(`[SSE] Session disposed: ${sessionId} [Reason: ${reason}] (Remaining: ${sessions.size})`);
    };

    req.on('close', () => disposeSession('req.close'));
    req.on('aborted', () => disposeSession('req.aborted'));
    res.on('close', () => disposeSession('res.close'));
    transport.onclose = () => disposeSession('transport.onclose');

    try {
      await server.connect(transport);
      res.write(': initial-flush\n\n');
    } catch (err: any) {
      console.error(`[SSE] Error connecting MCP server for session ${sessionId}:`, err);
      await disposeSession('connect_error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE stream', details: err.message });
      }
    }
  };

  // =========================================================================
  // MCP JSON-RPC Message Ingestion (Hybrid SSE + Streamable HTTP)
  // Supports both stateful SSE sessions and direct Streamable HTTP JSON-RPC
  // =========================================================================
  const handleIncomingMessage = async (req: Request, res: Response): Promise<void> => {
    let sessionId =
      (req.query.sessionId as string) ||
      (req.headers['x-session-id'] as string) ||
      (req.headers['mcp-session-id'] as string);

    // 1. Direct match with an active SSE session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      try {
        await session.transport.handlePostMessage(req, res, req.body);
      } catch (err: any) {
        console.error(`[MCP-SSE] Error handling POST message for session ${sessionId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to process SSE JSON-RPC message.',
            details: err.message
          });
        }
      }
      return;
    }

    // 2. Single active SSE session fallback if sessionId omitted by client
    if (!sessionId && sessions.size === 1) {
      const singleSession = Array.from(sessions.values())[0];
      try {
        await singleSession.transport.handlePostMessage(req, res, req.body);
      } catch (err: any) {
        console.error(
          `[MCP-SSE] Error handling POST message for single session ${singleSession.sessionId}:`,
          err
        );
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to process SSE JSON-RPC message.',
            details: err.message
          });
        }
      }
      return;
    }

    // 3. Stateless / Streamable HTTP JSON-RPC Mode
    // Handles clients that POST directly (e.g. Gemini Spark initialize and tools queries)
    const isJsonRpc =
      req.body &&
      typeof req.body === 'object' &&
      ('jsonrpc' in req.body || 'method' in req.body || Array.isArray(req.body));

    if (isJsonRpc) {
      try {
        const streamableTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });
        const server = createMcpServer(config);
        await server.connect(streamableTransport);
        await streamableTransport.handleRequest(req, res, req.body);

        res.on('finish', () => {
          setImmediate(async () => {
            try {
              await streamableTransport.close();
            } catch {}
            try {
              await server.close();
            } catch {}
          });
        });
        return;
      } catch (err: any) {
        console.error(`[MCP-Streamable] Error processing JSON-RPC request:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal error processing MCP JSON-RPC message',
              data: err.message
            },
            id: req.body?.id ?? null
          });
        }
        return;
      }
    }

    // 4. Invalid or unrecognized request
    res.status(400).json({
      error: 'Bad Request',
      message:
        'Missing valid JSON-RPC payload or unrecognized session ID. ' +
        'Send standard JSON-RPC 2.0 requests (e.g. initialize) or establish an SSE stream via GET /sse.'
    });
  };

  // Route GET endpoints for SSE streaming
  app.get('/sse', authenticate, handleSseConnection);
  app.get('/mcp', authenticate, handleSseConnection);

  // Root endpoint: Serves SSE if stream requested, otherwise JSON discovery
  app.get('/', (req: Request, res: Response) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream')) {
      return authenticate(req, res, () => handleSseConnection(req, res));
    }
    res.json({
      name: 'moon-link-discord',
      version: '1.0.0',
      status: 'running',
      protocolVersion: '2024-11-05',
      endpoints: {
        sse: '/sse',
        messages: '/messages',
        health: '/health'
      }
    });
  });

  // Route POST endpoints for JSON-RPC messages (handles all standard MCP paths)
  app.post('/messages', authenticate, handleIncomingMessage);
  app.post('/message', authenticate, handleIncomingMessage);
  app.post('/sse', authenticate, handleIncomingMessage);
  app.post('/mcp', authenticate, handleIncomingMessage);
  app.post('/', (req: Request, res: Response, next: NextFunction) => {
    if (
      req.query.sessionId ||
      req.headers['x-session-id'] ||
      req.headers['mcp-session-id'] ||
      req.body?.jsonrpc ||
      req.body?.method
    ) {
      return authenticate(req, res, () => handleIncomingMessage(req, res));
    }
    next();
  });

  // Session termination endpoints (Streamable HTTP spec)
  app.delete('/mcp', authenticate, (_req: Request, res: Response) => {
    res.status(200).json({ jsonrpc: '2.0', result: null, id: null });
  });
  app.delete('/sse', authenticate, (_req: Request, res: Response) => {
    res.status(200).json({ jsonrpc: '2.0', result: null, id: null });
  });

  // Start HTTP Listener
  app.listen(config.port, config.host, () => {
    console.error(`=============================================================`);
    console.error(`  MOON-LINK REMOTE MCP SERVER (HYBRID SSE + STREAMABLE HTTP) `);
    console.error(`=============================================================`);
    console.error(`  Listening on: http://${config.host}:${config.port}`);
    console.error(`  SSE Stream:   http://${config.host}:${config.port}/sse`);
    console.error(`  Messages:     http://${config.host}:${config.port}/messages`);
    console.error(`  Health Check: http://${config.host}:${config.port}/health`);
    console.error(`  Auth Mode:    BEARER TOKEN / ?token= (Enforced)`);
    console.error(`=============================================================`);
  });
}
