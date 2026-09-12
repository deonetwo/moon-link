import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppConfig } from '../config.js';
import { createMcpServer } from '../server.js';

export async function runStdioServer(config: AppConfig): Promise<void> {
  // CRITICAL FOR STDIO MCP: Redirect console.log to console.error
  // Standard output (stdout) is reserved strictly for JSON-RPC messages.
  // Any stray console.log will corrupt the MCP communication.
  console.log = (...args: any[]) => {
    console.error(...args);
  };

  console.error('[MCP] Starting Moon-Link Discord MCP Server in STDIO mode...');
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('[MCP] Stdio transport connected and listening.');
}
