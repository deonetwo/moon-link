import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatChannel, formatGuild, formatRole, resolveGuild } from '../discord.js';

export function registerServerResources(server: McpServer) {
  // 1. discord://server/overview
  server.resource(
    'server-overview',
    'discord://server/overview',
    async (uri) => {
      try {
        const guild = await resolveGuild();
        const info = formatGuild(guild);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(info, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error retrieving server overview: ${err.message}`
            }
          ]
        };
      }
    }
  );

  // 2. discord://channels/list
  server.resource(
    'channels-list',
    'discord://channels/list',
    async (uri) => {
      try {
        const guild = await resolveGuild();
        const channels = await guild.channels.fetch();
        const formatted = Array.from(channels.values())
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .map(formatChannel)
          .sort((a, b) => a.position - b.position);

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error listing channels: ${err.message}`
            }
          ]
        };
      }
    }
  );

  // 3. discord://roles/list
  server.resource(
    'roles-list',
    'discord://roles/list',
    async (uri) => {
      try {
        const guild = await resolveGuild();
        const roles = await guild.roles.fetch();
        const formatted = Array.from(roles.values())
          .map(formatRole)
          .sort((a, b) => b.position - a.position);

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error listing roles: ${err.message}`
            }
          ]
        };
      }
    }
  );
}
