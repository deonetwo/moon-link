import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatChannel, formatGuild, formatMember, formatRole, resolveGuild, resolveMember } from '../discord.js';

export function registerGuildTools(server: McpServer) {
  // 1. get_server_info
  server.tool(
    'get_server_info',
    'Get comprehensive information and statistics about the Discord server',
    {
      guild_id: z.string().optional().describe('Discord Server (Guild) ID. Defaults to configured DISCORD_GUILD_ID')
    },
    async ({ guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const info = formatGuild(guild);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error fetching server info: ${err.message}` }]
        };
      }
    }
  );

  // 2. list_channels
  server.tool(
    'list_channels',
    'List all channels in the Discord server with their type, category, position, and topic',
    {
      guild_id: z.string().optional().describe('Discord Server ID. Defaults to configured server'),
      type: z.enum(['all', 'text', 'voice', 'category', 'announcement', 'forum']).optional().describe('Filter by channel type (default: all)')
    },
    async ({ guild_id, type }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const channels = await guild.channels.fetch();
        const formatted = Array.from(channels.values())
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .map(formatChannel)
          .filter((c) => {
            if (!type || type === 'all') return true;
            return String(c.type).toLowerCase().includes(type.toLowerCase());
          })
          .sort((a, b) => a.position - b.position);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing channels: ${err.message}` }]
        };
      }
    }
  );

  // 3. list_roles
  server.tool(
    'list_roles',
    'List all roles in the server ordered by hierarchy with permissions and member counts',
    {
      guild_id: z.string().optional().describe('Discord Server ID. Defaults to configured server')
    },
    async ({ guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const roles = await guild.roles.fetch();
        const formatted = Array.from(roles.values())
          .map(formatRole)
          .sort((a, b) => b.position - a.position);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing roles: ${err.message}` }]
        };
      }
    }
  );

  // 4. list_members
  server.tool(
    'list_members',
    'List or search members in the server (supports query search and role filtering)',
    {
      guild_id: z.string().optional().describe('Discord Server ID. Defaults to configured server'),
      limit: z.number().int().min(1).max(100).optional().describe('Max number of members to return (1-100, default: 50)'),
      query: z.string().optional().describe('Search query to match username or nickname'),
      role_id: z.string().optional().describe('Filter members who have a specific Role ID')
    },
    async ({ guild_id, limit = 50, query, role_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        let members;
        if (query) {
          members = await guild.members.search({ query, limit });
        } else {
          members = await guild.members.fetch({ limit });
        }

        let memberList = Array.from(members.values());
        if (role_id) {
          memberList = memberList.filter((m) => m.roles.cache.has(role_id));
        }

        const formatted = memberList.slice(0, limit).map(formatMember);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing members: ${err.message}` }]
        };
      }
    }
  );

  // 5. get_member
  server.tool(
    'get_member',
    'Get detailed information about a specific member (roles, permissions, account age, timeout status)',
    {
      user_id: z.string().describe('The Discord User ID of the member'),
      guild_id: z.string().optional().describe('Discord Server ID. Defaults to configured server')
    },
    async ({ user_id, guild_id }) => {
      try {
        const member = await resolveMember(user_id, guild_id);
        const formatted = formatMember(member);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error fetching member info: ${err.message}` }]
        };
      }
    }
  );
}
