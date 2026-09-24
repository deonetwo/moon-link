import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Collection, ColorResolvable, EmbedBuilder, Message, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { formatDiscordApiError, formatMessage, getBotMember, resolveGuild, resolveTextChannel } from '../discord.js';
import { enforceConfirmation, validateBotPermissions, validateSnowflake } from '../security.js';

export function registerMessageTools(server: McpServer, config: AppConfig) {
  // 1. send_message
  server.tool(
    'send_message',
    'Send a message or embed to a Discord text or announcement channel',
    {
      channel_id: z.string().describe('Target Discord Channel Name (e.g. "bot-commands", "#general") or Snowflake ID'),
      content: z.string().max(2000).optional().describe('Text content of the message (max 2000 characters)'),
      reply_to_message_id: z.string().optional().describe('Optional Message ID to reply to'),
      guild_id: z.string().optional().describe('Discord Server ID'),
      embed: z
        .object({
          title: z.string().max(256).optional(),
          description: z.string().max(4096).optional(),
          color_hex: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Must be #RRGGBB').optional(),
          url: z.string().url().optional(),
          fields: z
            .array(
              z.object({
                name: z.string().max(256),
                value: z.string().max(1024),
                inline: z.boolean().optional()
              })
            )
              .optional(),
          footer: z.string().max(2048).optional()
        })
        .optional()
        .describe('Rich embed to include in the message')
    },
    async ({ channel_id, content, reply_to_message_id, guild_id, embed }) => {
      try {
        if (!content && !embed) {
          throw new Error('Either "content" or "embed" must be provided to send a message.');
        }

        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        // Verify bot can send messages in this channel
        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.SendMessages], 'send_message');
        }

        const messageOptions: any = {};
        if (content) {
          messageOptions.content = content;
        }

        if (embed) {
          const embedBuilder = new EmbedBuilder();
          if (embed.title) embedBuilder.setTitle(embed.title);
          if (embed.description) embedBuilder.setDescription(embed.description);
          if (embed.color_hex) embedBuilder.setColor(embed.color_hex as ColorResolvable);
          if (embed.url) embedBuilder.setURL(embed.url);
          if (embed.footer) embedBuilder.setFooter({ text: embed.footer });
          if (embed.fields && embed.fields.length > 0) {
            embedBuilder.addFields(embed.fields);
          }
          messageOptions.embeds = [embedBuilder];
        }

        if (reply_to_message_id) {
          const validReplyId = validateSnowflake(reply_to_message_id, 'reply_to_message_id');
          messageOptions.reply = { messageReference: validReplyId, failIfNotExists: false };
        }

        const sent = await channel.send(messageOptions);
        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully!\nMessage ID: ${sent.id}\nChannel: #${channel.name} (${channel.id})\nCreated At: ${sent.createdAt.toISOString()}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'send_message') }]
        };
      }
    }
  );

  // 2. read_channel_messages
  server.tool(
    'read_channel_messages',
    'Read recent messages from a channel (supports limit, before/after filters, channel name or ID)',
    {
      channel_id: z.string().describe('Channel Name (e.g. "bot-commands", "#general") or Snowflake ID to fetch messages from'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of messages to retrieve (1-100, default: 25)'),
      before_message_id: z.string().optional().describe('Fetch messages sent before this Message ID'),
      after_message_id: z.string().optional().describe('Fetch messages sent after this Message ID'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, limit = 25, before_message_id, after_message_id, guild_id }) => {
      try {
        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], 'read_channel_messages');
        }

        const fetchOptions: any = { limit: Math.min(limit, config.maxMessageHistory) };
        if (before_message_id) {
          fetchOptions.before = validateSnowflake(before_message_id, 'before_message_id');
        }
        if (after_message_id) {
          fetchOptions.after = validateSnowflake(after_message_id, 'after_message_id');
        }

        const fetched = (await channel.messages.fetch(fetchOptions)) as unknown as Collection<string, Message>;
        const formatted = Array.from(fetched.values()).map(formatMessage);

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
          content: [{ type: 'text', text: formatDiscordApiError(err, 'read_channel_messages') }]
        };
      }
    }
  );

  // 3. delete_message (Destructive - requires confirm: true)
  server.tool(
    'delete_message',
    'Delete a specific message from a channel. Requires confirm: true.',
    {
      channel_id: z.string().describe('Channel Name or ID where the message is located'),
      message_id: z.string().describe('The ID of the message to delete'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to delete the message'),
      reason: z.string().optional().describe('Reason for deletion (visible in audit log)'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, message_id, confirm, reason, guild_id }) => {
      try {
        enforceConfirmation('delete_message', `message ${message_id} in channel ${channel_id}`, confirm, config);

        const validMsgId = validateSnowflake(message_id, 'message_id');
        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const targetMsg = await channel.messages.fetch(validMsgId);
        // If it's not the bot's own message, verify ManageMessages permission
        if (targetMsg.author.id !== botMember.id) {
          const permissions = channel.permissionsFor(botMember);
          if (permissions) {
            validateBotPermissions(permissions, [PermissionFlagsBits.ManageMessages], 'delete_message');
          }
        }

        await targetMsg.delete();
        return {
          content: [
            {
              type: 'text',
              text: `Message ${validMsgId} successfully deleted from #${channel.name}${reason ? ` (Reason: ${reason})` : ''}.`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'delete_message') }]
        };
      }
    }
  );

  // 4. purge_messages (Destructive - requires confirm: true)
  server.tool(
    'purge_messages',
    'Bulk delete up to 100 recent messages in a channel (messages older than 14 days cannot be bulk deleted). Requires confirm: true.',
    {
      channel_id: z.string().describe('Target Channel Name or ID'),
      count: z.number().int().min(2).max(100).describe('Number of messages to purge (2-100)'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to execute destructive deletion'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, count, confirm, guild_id }) => {
      try {
        enforceConfirmation('purge_messages', `${count} messages in channel ${channel_id}`, confirm, config);

        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.ManageMessages], 'purge_messages');
        }

        const deleted = await channel.bulkDelete(count, true);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully purged ${deleted.size} messages from #${channel.name} (${channel.id}).`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'purge_messages') }]
        };
      }
    }
  );

  // 5. add_reaction
  server.tool(
    'add_reaction',
    'Add an emoji reaction to a Discord message',
    {
      channel_id: z.string().describe('Channel Name or ID of the message'),
      message_id: z.string().describe('Message ID to react to'),
      emoji: z.string().describe('Emoji to add (e.g. "👍", "🔥", or custom emoji name/id)'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, message_id, emoji, guild_id }) => {
      try {
        const validMsgId = validateSnowflake(message_id, 'message_id');
        const channel = await resolveTextChannel(channel_id, guild_id);
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);

        const permissions = channel.permissionsFor(botMember);
        if (permissions) {
          validateBotPermissions(permissions, [PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory], 'add_reaction');
        }

        const targetMsg = await channel.messages.fetch(validMsgId);
        await targetMsg.react(emoji.trim());

        return {
          content: [
            {
              type: 'text',
              text: `Successfully added reaction ${emoji} to message ${validMsgId}.`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'add_reaction') }]
        };
      }
    }
  );

  // 6. create_thread
  server.tool(
    'create_thread',
    'Create a new thread in a text channel or from an existing message',
    {
      channel_id: z.string().describe('Channel Name or ID where thread will be created'),
      name: z.string().min(1).max(100).describe('Name of the thread'),
      message_id: z.string().optional().describe('Optional Message ID to start thread from'),
      auto_archive_duration: z.enum(['60', '1440', '4320', '10080']).optional().describe('Auto-archive minutes (60, 1440=1d, 4320=3d, 10080=7d)'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ channel_id, name, message_id, auto_archive_duration, guild_id }) => {
      try {
        const channel = await resolveTextChannel(channel_id, guild_id);
        if (!('threads' in channel)) {
          throw new Error(`Channel #${channel.name} does not support creating threads.`);
        }

        const duration = auto_archive_duration ? parseInt(auto_archive_duration, 10) : 1440;
        let thread;

        if (message_id) {
          const validMsgId = validateSnowflake(message_id, 'message_id');
          const targetMsg = await channel.messages.fetch(validMsgId);
          thread = await targetMsg.startThread({
            name,
            autoArchiveDuration: duration as any
          });
        } else {
          thread = await (channel as any).threads.create({
            name,
            autoArchiveDuration: duration
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: `Thread "${thread.name}" created successfully!\nThread ID: ${thread.id}\nParent Channel: #${channel.name}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiscordApiError(err, 'create_thread') }]
        };
      }
    }
  );
}
