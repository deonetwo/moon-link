import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { formatChannel, formatDiscordApiError, getBotMember, resolveChannel, resolveGuild } from '../discord.js';
import { enforceConfirmation, validateBotPermissions, validateSnowflake } from '../security.js';

export function registerChannelTools(server: McpServer, config: AppConfig) {
  // 1. create_channel
  server.tool(
    'create_channel',
    'Create a new channel or category in the Discord server',
    {
      name: z.string().min(1).max(100).describe('Name of the new channel'),
      type: z.enum(['text', 'voice', 'category', 'announcement', 'stage']).default('text').describe('Channel type'),
      topic: z.string().max(1024).optional().describe('Channel topic (text channels only)'),
      parent_category_id: z.string().optional().describe('Parent Category ID where the channel will be placed'),
      nsfw: z.boolean().optional().describe('Whether channel is age-restricted (NSFW)'),
      rate_limit_per_user: z.number().int().min(0).max(21600).optional().describe('Slowmode in seconds (0 = off, max 21600 = 6h)'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ name, type, topic, parent_category_id, nsfw, rate_limit_per_user, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageChannels], 'create_channel');

        let channelType = ChannelType.GuildText;
        if (type === 'voice') channelType = ChannelType.GuildVoice;
        else if (type === 'category') channelType = ChannelType.GuildCategory;
        else if (type === 'announcement') channelType = ChannelType.GuildAnnouncement;
        else if (type === 'stage') channelType = ChannelType.GuildStageVoice;

        const channelOptions: any = {
          name,
          type: channelType
        };

        if (topic && channelType === ChannelType.GuildText) {
          channelOptions.topic = topic;
        }

        if (parent_category_id) {
          channelOptions.parent = validateSnowflake(parent_category_id, 'parent_category_id');
        }

        if (nsfw !== undefined && channelType !== ChannelType.GuildCategory) {
          channelOptions.nsfw = nsfw;
        }

        if (rate_limit_per_user !== undefined && channelType === ChannelType.GuildText) {
          channelOptions.rateLimitPerUser = rate_limit_per_user;
        }

        const newChannel = await guild.channels.create(channelOptions);
        return {
          content: [
            {
              type: 'text',
              text: `Channel created successfully!\nName: #${newChannel.name}\nID: ${newChannel.id}\nType: ${ChannelType[newChannel.type]}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'create_channel') }]
        };
      }
    }
  );

  // 2. modify_channel
  server.tool(
    'modify_channel',
    'Modify properties of an existing channel (name, topic, category, slowmode, nsfw)',
    {
      channel_id: z.string().describe('Channel ID to modify'),
      name: z.string().min(1).max(100).optional().describe('New channel name'),
      topic: z.string().max(1024).optional().describe('New channel topic'),
      parent_category_id: z.string().nullable().optional().describe('New Parent Category ID (or null to remove category)'),
      rate_limit_per_user: z.number().int().min(0).max(21600).optional().describe('Slowmode in seconds (0 = off)'),
      nsfw: z.boolean().optional().describe('Age-restricted / NSFW flag'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, name, topic, parent_category_id, rate_limit_per_user, nsfw, reason, guild_id }) => {
      try {
        const channel = await resolveChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.ManageChannels], 'modify_channel');
        }

        const editOptions: any = {};
        if (name) editOptions.name = name;
        if (topic !== undefined && 'setTopic' in channel) editOptions.topic = topic;
        if (parent_category_id !== undefined) {
          editOptions.parent = parent_category_id ? validateSnowflake(parent_category_id, 'parent_category_id') : null;
        }
        if (rate_limit_per_user !== undefined && 'setRateLimitPerUser' in channel) {
          editOptions.rateLimitPerUser = rate_limit_per_user;
        }
        if (nsfw !== undefined && 'setNSFW' in channel) {
          editOptions.nsfw = nsfw;
        }
        if (reason) editOptions.reason = reason;

        const updated = await (channel as any).edit(editOptions);
        return {
          content: [
            {
              type: 'text',
              text: `Channel updated successfully!\n${JSON.stringify(formatChannel(updated), null, 2)}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'modify_channel') }]
        };
      }
    }
  );

  // 3. delete_channel (Destructive - requires confirm: true)
  server.tool(
    'delete_channel',
    'Permanently delete a channel or category. Requires confirm: true.',
    {
      channel_id: z.string().describe('Channel ID to delete'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to delete the channel'),
      reason: z.string().optional().describe('Reason for deletion in audit log'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, confirm, reason, guild_id }) => {
      try {
        const channel = await resolveChannel(channel_id, guild_id);
        enforceConfirmation('delete_channel', `channel #${channel.name} (${channel.id})`, confirm, config);

        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.ManageChannels], 'delete_channel');
        }

        const channelName = channel.name;
        await channel.delete(reason || 'Deleted via MCP server tool');

        return {
          content: [
            {
              type: 'text',
              text: `Channel #${channelName} (${channel_id}) was permanently deleted.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'delete_channel') }]
        };
      }
    }
  );
}
