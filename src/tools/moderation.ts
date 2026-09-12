import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { getBotMember, resolveGuild, resolveMember } from '../discord.js';
import {
  enforceConfirmation,
  validateBotPermissions,
  validateMemberHierarchy,
  validateSnowflake
} from '../security.js';

export function registerModerationTools(server: McpServer, config: AppConfig) {
  // 1. timeout_member
  server.tool(
    'timeout_member',
    'Temporarily timeout (mute) a member in the server',
    {
      user_id: z.string().describe('User ID of the member to timeout'),
      duration_minutes: z.number().int().min(1).max(40320).describe('Duration in minutes (max 40,320 = 28 days)'),
      reason: z.string().optional().describe('Reason for timeout'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, duration_minutes, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ModerateMembers], 'timeout_member');

        const member = await resolveMember(user_id, guild_id);
        validateMemberHierarchy(botMember, member, 'timeout_member');

        const timeoutMilliseconds = duration_minutes * 60 * 1000;
        await member.timeout(timeoutMilliseconds, reason || 'Timed out via MCP server');

        return {
          content: [
            {
              type: 'text',
              text: `Member ${member.user.tag} (${member.id}) was timed out for ${duration_minutes} minutes.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error timing out member: ${err.message}` }]
        };
      }
    }
  );

  // 2. remove_timeout
  server.tool(
    'remove_timeout',
    'Remove timeout (unmute) from a server member',
    {
      user_id: z.string().describe('User ID of the member'),
      reason: z.string().optional().describe('Reason for removing timeout'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ModerateMembers], 'remove_timeout');

        const member = await resolveMember(user_id, guild_id);
        validateMemberHierarchy(botMember, member, 'remove_timeout');

        await member.timeout(null, reason || 'Timeout removed via MCP server');
        return {
          content: [
            {
              type: 'text',
              text: `Timeout was successfully removed for ${member.user.tag} (${member.id}).`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error removing timeout: ${err.message}` }]
        };
      }
    }
  );

  // 3. kick_member (Destructive - requires confirm: true)
  server.tool(
    'kick_member',
    'Kick a member from the Discord server. Requires confirm: true.',
    {
      user_id: z.string().describe('User ID of the member to kick'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to kick member'),
      reason: z.string().optional().describe('Reason for the kick'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, confirm, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.KickMembers], 'kick_member');

        const member = await resolveMember(user_id, guild_id);
        validateMemberHierarchy(botMember, member, 'kick_member');

        enforceConfirmation('kick_member', `user ${member.user.tag} (${member.id})`, confirm, config);

        const memberTag = member.user.tag;
        await member.kick(reason || 'Kicked via MCP server');

        return {
          content: [
            {
              type: 'text',
              text: `Member ${memberTag} (${user_id}) was kicked from the server.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error kicking member: ${err.message}` }]
        };
      }
    }
  );

  // 4. ban_member (Destructive - requires confirm: true)
  server.tool(
    'ban_member',
    'Ban a member or user from the Discord server. Requires confirm: true.',
    {
      user_id: z.string().describe('User ID to ban'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to ban user'),
      delete_message_days: z.number().int().min(0).max(7).optional().describe('Number of days of message history to delete (0-7, default: 0)'),
      reason: z.string().optional().describe('Reason for the ban'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, confirm, delete_message_days = 0, reason, guild_id }) => {
      try {
        const validUserId = validateSnowflake(user_id, 'user_id');
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.BanMembers], 'ban_member');

        // Check if user is currently in the guild to verify hierarchy
        const targetMember = await guild.members.fetch(validUserId).catch(() => null);
        if (targetMember) {
          validateMemberHierarchy(botMember, targetMember, 'ban_member');
        }

        enforceConfirmation('ban_member', `user ${targetMember?.user.tag || validUserId}`, confirm, config);

        const deleteMessageSeconds = delete_message_days * 24 * 60 * 60;
        await guild.bans.create(validUserId, {
          deleteMessageSeconds,
          reason: reason || 'Banned via MCP server'
        });

        return {
          content: [
            {
              type: 'text',
              text: `User ${targetMember?.user.tag || validUserId} was banned from the server.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error banning user: ${err.message}` }]
        };
      }
    }
  );

  // 5. unban_member
  server.tool(
    'unban_member',
    'Unban a user from the Discord server',
    {
      user_id: z.string().describe('User ID to unban'),
      reason: z.string().optional().describe('Reason for unbanning'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, reason, guild_id }) => {
      try {
        const validUserId = validateSnowflake(user_id, 'user_id');
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.BanMembers], 'unban_member');

        await guild.bans.remove(validUserId, reason || 'Unbanned via MCP server');
        return {
          content: [
            {
              type: 'text',
              text: `User ${validUserId} was unbanned from the server.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error unbanning user: ${err.message}` }]
        };
      }
    }
  );

  // 6. list_bans
  server.tool(
    'list_bans',
    'List banned users and their ban reasons',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Max bans to retrieve (1-100, default: 50)'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ limit = 50, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.BanMembers], 'list_bans');

        const bans = await guild.bans.fetch({ limit });
        const formatted = Array.from(bans.values()).map((b) => ({
          user: {
            id: b.user.id,
            username: b.user.username,
            tag: b.user.tag
          },
          reason: b.reason || '(no reason specified)'
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
          content: [{ type: 'text', text: `Error listing bans: ${err.message}` }]
        };
      }
    }
  );
}
