import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { formatDiscordApiError, getBotMember, resolveGuild, resolveTextChannel } from '../discord.js';
import { validateBotPermissions, validateSnowflake } from '../security.js';

export function registerAuditTools(server: McpServer, _config: AppConfig) {
  // 1. create_invite
  server.tool(
    'create_invite',
    'Create an invite link for a Discord channel',
    {
      channel_id: z.string().describe('Channel ID to create the invite for'),
      max_age_seconds: z.number().int().min(0).max(604800).optional().describe('Invite duration in seconds (0 = never, max 604800 = 7 days, default 86400 = 24h)'),
      max_uses: z.number().int().min(0).max(100).optional().describe('Max uses (0 = unlimited, default: 0)'),
      unique: z.boolean().optional().describe('Ensure unique invite code (default: true)'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, max_age_seconds = 86400, max_uses = 0, unique = true, reason, guild_id }) => {
      try {
        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.CreateInstantInvite], 'create_invite');
        }

        if (!('createInvite' in channel) || typeof (channel as any).createInvite !== 'function') {
          throw new Error(`Channel #${channel.name} (${channel.id}) does not support creating invites.`);
        }

        const invite = await (channel as any).createInvite({
          maxAge: max_age_seconds,
          maxUses: max_uses,
          unique,
          reason: reason || 'Created via MCP server'
        });

        return {
          content: [
            {
              type: 'text',
              text: `Invite created successfully!\nURL: ${invite.url}\nCode: ${invite.code}\nChannel: #${channel.name}\nExpires: ${invite.expiresAt ? invite.expiresAt.toISOString() : 'Never'}\nMax Uses: ${invite.maxUses || 'Unlimited'}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'create_invite') }]
        };
      }
    }
  );

  // 2. list_invites
  server.tool(
    'list_invites',
    'List all active invite links for the Discord server',
    {
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageGuild], 'list_invites');

        const invites = await guild.invites.fetch();
        const formatted = Array.from(invites.values()).map((inv) => ({
          code: inv.code,
          url: inv.url,
          channel: inv.channel ? { id: inv.channel.id, name: inv.channel.name } : null,
          inviter: inv.inviter ? { id: inv.inviter.id, tag: inv.inviter.tag } : null,
          uses: inv.uses,
          maxUses: inv.maxUses,
          createdAt: inv.createdAt?.toISOString() || null,
          expiresAt: inv.expiresAt?.toISOString() || null
        }));

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
          content: [{ type: 'text', text: formatDiscordApiError(err, 'list_invites') }]
        };
      }
    }
  );

  // 3. get_audit_logs
  server.tool(
    'get_audit_logs',
    'Retrieve recent audit log entries from the server (moderation, channel/role changes, etc.)',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Number of entries to fetch (1-100, default: 20)'),
      user_id: z.string().optional().describe('Filter logs by the user who executed the action'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ limit = 20, user_id, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ViewAuditLog], 'get_audit_logs');

        const fetchOptions: any = { limit };
        if (user_id) {
          fetchOptions.user = validateSnowflake(user_id, 'user_id');
        }

        const logs = await guild.fetchAuditLogs(fetchOptions);
        const formatted = logs.entries.map((entry) => ({
          id: entry.id,
          action: entry.action,
          actionType: entry.actionType,
          executor: entry.executor ? { id: entry.executor.id, tag: entry.executor.tag } : null,
          target: entry.target ? (typeof entry.target === 'object' && 'id' in entry.target ? { id: entry.target.id } : String(entry.target)) : null,
          reason: entry.reason || null,
          createdAt: entry.createdAt.toISOString()
        }));

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
          content: [{ type: 'text', text: formatDiscordApiError(err, 'get_audit_logs') }]
        };
      }
    }
  );
}
