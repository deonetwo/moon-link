import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppConfig } from './config.js';
import { registerServerResources } from './resources/serverResources.js';
import { registerAuditTools } from './tools/audit.js';
import { registerChannelTools } from './tools/channels.js';
import { registerGuildTools } from './tools/guild.js';
import { registerMessageTools } from './tools/messages.js';
import { registerModerationTools } from './tools/moderation.js';
import { registerRoleTools } from './tools/roles.js';

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: 'moon-link-discord',
    version: '1.0.0'
  });

  // Register all modular tools
  registerGuildTools(server);
  registerMessageTools(server, config);
  registerChannelTools(server, config);
  registerRoleTools(server, config);
  registerModerationTools(server, config);
  registerAuditTools(server, config);

  // Register MCP Resources
  registerServerResources(server);

  return server;
}
