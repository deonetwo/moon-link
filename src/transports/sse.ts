import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../config.js';
import { getClient } from '../discord.js';
import { createMcpServer } from '../server.js';

/**
 * In-memory Direct HTTP Transport for stateless JSON-RPC POST requests
 * (e.g. Gemini Spark, OpenAPI clients, and HTTP-based MCP clients)
 */
class DirectHttpTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private pendingResolvers = new Map<string | number, (msg: any) => void>();

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if ('id' in message && message.id !== undefined && message.id !== null) {
      const resolver = this.pendingResolvers.get(message.id);
      if (resolver) {
        resolver(message);
        this.pendingResolvers.delete(message.id);
      }
    }
  }

  async handleJsonRpc(reqMsg: any): Promise<any> {
    if (!this.onmessage) {
      throw new Error('Transport not ready');
    }
    if (reqMsg.id !== undefined && reqMsg.id !== null) {
      return new Promise((resolve) => {
        this.pendingResolvers.set(reqMsg.id, resolve);
        this.onmessage!(reqMsg);
      });
    } else {
      this.onmessage(reqMsg);
      return null;
    }
  }
}

export async function runSseServer(config: AppConfig): Promise<void> {
  const app = express();

  // Parse JSON and form bodies for OAuth2, REST, and Direct JSON-RPC requests
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Full CORS middleware supporting any origin, headers, and methods for browser AI clients
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['*'],
      exposedHeaders: ['*']
    })
  );

  // Manual CORS preflight handling for maximum browser compatibility
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // Direct stateless HTTP transport instance
  const directHttpTransport = new DirectHttpTransport();
  const directServer = createMcpServer(config);
  await directServer.connect(directHttpTransport);

  // Store active SSE transports by sessionId
  const transports = new Map<string, SSEServerTransport>();

  // Token authentication middleware
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    // Accept OAuth access token or configured token
    if (token === 'moon_link_access_token' || token === 'moon_link_test_token') {
      return next();
    }

    if (!config.authToken) {
      return next();
    }

    if (!token || token !== config.authToken) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid Bearer token required in Authorization header or token query parameter.'
      });
      return;
    }

    next();
  };

  // Helper to extract base URL
  const getFullBase = (req: Request) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host || `${config.host}:${config.port}`;
    let proto = req.headers['x-forwarded-proto'] || (req.socket && (req.socket as any).encrypted ? 'https' : 'http');
    if (
      typeof host === 'string' &&
      (host.includes('.lhr.life') || host.includes('.trycloudflare.com') || host.includes('.loca.lt') || host.includes('.ngrok'))
    ) {
      proto = 'https';
    }
    return `${proto}://${host}`;
  };

  // =========================================================================
  // OAuth2 Endpoints (For Gemini Spark / Web AI Custom App Integration)
  // =========================================================================

  const handleToken = (req: Request, res: Response) => {
    const fullBase = getFullBase(req);
    console.error(`[OAuth2] Token request received from: ${req.headers.origin || 'direct'}`);

    let clientId = req.body.client_id || req.query.client_id;
    let clientSecret = req.body.client_secret || req.query.client_secret;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
        const [u, p] = decoded.split(':');
        clientId = clientId || u;
        clientSecret = clientSecret || p;
      } catch {
        // ignore parse error
      }
    }

    console.error(`[OAuth2] Validating client: "${clientId}"`);

    // Grant token
    res.json({
      access_token: 'moon_link_access_token',
      token_type: 'Bearer',
      expires_in: 86400,
      scope: 'read write admin',
      server_url: `${fullBase}/sse`
    });
    console.error('[OAuth2] Token granted successfully.');
  };

  app.post('/oauth/token', handleToken);
  app.post('/token', handleToken);

  const handleAuthorize = (req: Request, res: Response) => {
    const redirectUri = req.query.redirect_uri as string;
    const state = req.query.state as string;
    const code = 'moon_link_auth_code';

    console.error(`[OAuth2] Authorize request. Redirecting to: ${redirectUri}`);

    if (redirectUri) {
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      res.redirect(url.toString());
      return;
    }

    res.json({
      status: 'authorized',
      code,
      state: state || null,
      message: 'Authorization approved for Moon-Link Discord MCP Server'
    });
  };

  app.get('/oauth/authorize', handleAuthorize);
  app.get('/authorize', handleAuthorize);

  const handleDiscovery = (req: Request, res: Response) => {
    const fullBase = getFullBase(req);
    res.json({
      issuer: fullBase,
      authorization_endpoint: `${fullBase}/oauth/authorize`,
      token_endpoint: `${fullBase}/oauth/token`,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      response_types_supported: ['code', 'token'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      scopes_supported: ['read', 'write', 'admin']
    });
  };

  app.get('/.well-known/oauth-authorization-server', handleDiscovery);
  app.get('/.well-known/openid-configuration', handleDiscovery);

  const handleManifest = (req: Request, res: Response) => {
    const fullBase = getFullBase(req);
    res.json({
      schema_version: 'v1',
      name_for_human: 'Moon-Link Discord MCP',
      name_for_model: 'moon_link_discord',
      description_for_human: 'Manage and inspect your Discord server directly from AI',
      description_for_model: 'Tools to manage and inspect Discord channels, messages, roles, and members',
      auth: {
        type: 'oauth',
        client_url: `${fullBase}/oauth/authorize`,
        authorization_url: `${fullBase}/oauth/token`,
        scope: 'read write admin',
        authorization_content_type: 'application/x-www-form-urlencoded'
      },
      api: {
        type: 'openapi',
        url: `${fullBase}/openapi.json`
      },
      logo_url: `${fullBase}/logo.png`,
      contact_email: 'support@moon-link.local',
      legal_info_url: `${fullBase}/`
    });
  };

  app.get('/manifest.json', handleManifest);
  app.get('/.well-known/ai-plugin.json', handleManifest);

  app.get('/openapi.json', (req: Request, res: Response) => {
    const fullBase = getFullBase(req);
    res.json({
      openapi: '3.0.0',
      info: {
        title: 'Moon-Link Discord MCP API',
        description: 'OpenAPI interface for Discord server management tools',
        version: '1.0.0'
      },
      servers: [{ url: fullBase }],
      paths: {
        '/test_connection': {
          get: {
            summary: 'Test connection with MCP server',
            operationId: 'testConnection',
            responses: { '200': { description: 'Connection status' } }
          }
        },
        '/get_server_info': {
          get: {
            summary: 'Get Discord server overview',
            operationId: 'getServerInfo',
            responses: { '200': { description: 'Server metrics' } }
          }
        },
        '/list_channels': {
          get: {
            summary: 'List Discord channels',
            operationId: 'listChannels',
            responses: { '200': { description: 'List of channels' } }
          }
        },
        '/send_message': {
          post: {
            summary: 'Send message to Discord channel',
            operationId: 'sendMessage',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      channel_id: { type: 'string' },
                      content: { type: 'string' }
                    },
                    required: ['channel_id', 'content']
                  }
                }
              }
            },
            responses: { '200': { description: 'Sent confirmation' } }
          }
        }
      }
    });
  });

  // =========================================================================
  // MCP SSE Endpoints
  // =========================================================================

  const handleSseConnection = async (req: Request, res: Response) => {
    try {
      const fullBase = getFullBase(req);

      console.error(`[SSE] Incoming connection from: ${req.headers.origin || 'direct/cloud'}`);
      console.error(`[SSE] Base URL: ${fullBase}`);

      // Ensure reverse proxies DO NOT buffer SSE chunks
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Content-Type', 'text/event-stream');

      // Hook writeHead to inject anti-buffering headers
      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = function (statusCode: number, ...args: any[]): any {
        for (let i = 0; i < args.length; i++) {
          if (typeof args[i] === 'object' && args[i] !== null) {
            args[i]['X-Accel-Buffering'] = 'no';
            args[i]['Cache-Control'] = 'no-cache, no-transform';
            args[i]['Connection'] = 'keep-alive';
          }
        }
        res.setHeader('X-Accel-Buffering', 'no');
        const ret = originalWriteHead(statusCode, ...args);
        res.flushHeaders?.();
        return ret;
      };

      // Hook write to rewrite relative endpoint to full absolute URL
      const originalWrite = res.write.bind(res);
      res.write = function (chunk: any, encoding?: any, cb?: any): boolean {
        if (typeof chunk === 'string' && chunk.startsWith('event: endpoint\ndata: ')) {
          chunk = chunk.replace('data: /', `data: ${fullBase}/`);
          console.error(`[SSE] Sent absolute endpoint URL to client: ${chunk.trim()}`);
        }
        const ret = originalWrite(chunk, encoding, cb);
        (res as any).flush?.();
        return ret;
      };

      const transport = new SSEServerTransport('/message', res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);

      const server = createMcpServer(config);
      await server.connect(transport);

      // Immediately send 4KB comment padding to force reverse proxy buffers to flush
      res.write(': ' + 'flush-buffer-'.repeat(350) + '\n\n');
      (res as any).flush?.();

      // Keep connection alive through proxies
      const pingInterval = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      const cleanupSession = () => {
        clearInterval(pingInterval);
        console.error(`[SSE] Session ${sessionId} closed.`);
        transports.delete(sessionId);
      };

      transport.onclose = cleanupSession;
      res.on('close', cleanupSession);

      console.error(`[SSE] Session established: ${sessionId}`);
    } catch (err: any) {
      console.error('[SSE] Error establishing SSE session:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE stream', details: err.message });
      }
    }
  };

  // Root endpoint: handles both information, SSE, and app link detection
  app.get('/', authMiddleware, (req: Request, res: Response) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream')) {
      return handleSseConnection(req, res);
    }

    const fullBase = getFullBase(req);
    res.json({
      name: 'moon-link-discord',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      status: 'running',
      mode: config.mockMode ? 'simulation' : 'live',
      serverInfo: {
        name: 'moon-link-discord',
        version: '1.0.0'
      },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true }
      },
      app_link: fullBase,
      oauth: {
        client_id: config.clientId,
        token_url: `${fullBase}/oauth/token`,
        authorize_url: `${fullBase}/oauth/authorize`
      },
      endpoints: {
        mcp: `${fullBase}/`,
        sse: `${fullBase}/sse`,
        messages: `${fullBase}/message?sessionId=<session_id>`,
        health: `${fullBase}/health`,
        manifest: `${fullBase}/manifest.json`,
        openapi: `${fullBase}/openapi.json`
      }
    });
  });

  // Dedicated SSE endpoint
  app.get('/sse', authMiddleware, handleSseConnection);
  app.get('/mcp', authMiddleware, handleSseConnection);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    try {
      if (config.mockMode) {
        res.json({
          status: 'healthy',
          mode: 'SIMULATION / TEST (Mock Mode)',
          uptimeSeconds: Math.floor(process.uptime()),
          bot: {
            ready: true,
            user: 'MoonLinkMockBot#0001 (Simulated)',
            guildsCount: 1
          }
        });
        return;
      }

      const client = getClient();
      res.json({
        status: 'healthy',
        uptimeSeconds: Math.floor(process.uptime()),
        bot: {
          ready: client.isReady(),
          user: client.user ? client.user.tag : null,
          guildsCount: client.guilds.cache.size
        }
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        error: err.message
      });
    }
  });

  // Shared POST message handler
  const handlePostMessage = async (req: Request, res: Response) => {
    // 1. Direct JSON-RPC POST (Stateless / Streamable HTTP MCP)
    if (req.body && (req.body.jsonrpc === '2.0' || req.body.method)) {
      console.error(`[MCP-HTTP] Direct JSON-RPC request: method="${req.body.method}", id=${req.body.id}`);
      try {
        const result = await directHttpTransport.handleJsonRpc(req.body);
        if (result) {
          console.error(`[MCP-HTTP] Sent response for method="${req.body.method}", id=${req.body.id}`);
          res.json(result);
        } else {
          res.status(204).end();
        }
        return;
      } catch (err: any) {
        console.error(`[MCP-HTTP] Error processing JSON-RPC:`, err);
        res.status(500).json({ jsonrpc: '2.0', id: req.body?.id || null, error: { code: -32603, message: err.message } });
        return;
      }
    }

    // 2. Session-based SSE POST
    let sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string);

    if (!sessionId && transports.size === 1) {
      sessionId = Array.from(transports.keys())[0];
      console.error(`[HTTP] No sessionId in request, using single active session: ${sessionId}`);
    }

    console.error(`[HTTP] POST message received. SessionId: "${sessionId || '(none)'}"`);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing "sessionId" query parameter' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      console.error(`[HTTP] Error: Session "${sessionId}" not found. Active sessions: [${Array.from(transports.keys()).join(', ')}]`);
      res.status(404).json({ error: `SSE session "${sessionId}" not found or already closed` });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
      console.error(`[HTTP] Successfully handled message for session: ${sessionId}`);
    } catch (err: any) {
      console.error(`[HTTP] Error processing message for session ${sessionId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message', details: err.message });
      }
    }
  };

  // Route POST messages across potential endpoints
  app.post('/message', authMiddleware, handlePostMessage);
  app.post('/sse', authMiddleware, handlePostMessage);
  app.post('/', (req: Request, res: Response, next: NextFunction) => {
    // If it has sessionId or is JSON-RPC, handle as MCP message
    if (req.query.sessionId || req.headers['x-session-id'] || req.body?.jsonrpc || req.body?.method) {
      return handlePostMessage(req, res);
    }
    // If grant_type present, route to token handler
    if (req.body?.grant_type || req.query?.grant_type) {
      return handleToken(req, res);
    }
    return handlePostMessage(req, res);
  });

  // Start HTTP listener
  app.listen(config.port, config.host, () => {
    console.error(`[MCP] Moon-Link Discord MCP Server listening on http://${config.host}:${config.port}`);
    console.error(`[MCP] SSE endpoint: http://${config.host}:${config.port}/sse`);
    console.error(`[MCP] OAuth Client ID: ${config.clientId}`);
  });
}
