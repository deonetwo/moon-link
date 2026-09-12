import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../config.js';
import { getClient } from '../discord.js';
import { createMcpServer } from '../server.js';

export async function runSseServer(config: AppConfig): Promise<void> {
  const app = express();
  app.use(cors());

  // Store active SSE transports by sessionId
  const transports = new Map<string, SSEServerTransport>();

  // Bearer token authentication middleware for secure AWS exposure
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authToken) {
      return next();
    }

    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query.token && typeof req.query.token === 'string') {
      token = req.query.token;
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

  // Root welcome & info
  app.get('/', (_req, res) => {
    res.json({
      name: 'moon-link-discord-mcp',
      status: 'running',
      authRequired: Boolean(config.authToken),
      allowedGuilds: config.allowedGuildIds,
      endpoints: {
        sse: '/sse',
        messages: '/message?sessionId=<session_id>',
        health: '/health'
      }
    });
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    try {
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

  // SSE endpoint - starts SSE connection
  app.get('/sse', authMiddleware, async (_req: Request, res: Response) => {
    try {
      console.error('[SSE] New SSE client connecting...');
      const transport = new SSEServerTransport('/message', res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);

      const server = createMcpServer(config);
      await server.connect(transport);

      transport.onclose = () => {
        console.error(`[SSE] Session ${sessionId} disconnected.`);
        transports.delete(sessionId);
      };

      console.error(`[SSE] Client connected with sessionId: ${sessionId}`);
    } catch (err: any) {
      console.error('[SSE] Error handling SSE connection:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE stream', details: err.message });
      }
    }
  });

  // Messages endpoint - receives JSON-RPC client messages
  app.post('/message', authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing "sessionId" query parameter' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `SSE session "${sessionId}" not found or already closed` });
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err: any) {
      console.error(`[SSE] Error processing message for session ${sessionId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message', details: err.message });
      }
    }
  });

  // Start HTTP listener
  app.listen(config.port, config.host, () => {
    console.error(`[MCP] Moon-Link Discord MCP Server listening on http://${config.host}:${config.port}`);
    console.error(`[MCP] SSE endpoint: http://${config.host}:${config.port}/sse`);
    console.error(`[MCP] Authentication: ${config.authToken ? 'ENABLED (Bearer token protected)' : 'DISABLED (Warning: No MCP_AUTH_TOKEN configured)'}`);
  });
}
