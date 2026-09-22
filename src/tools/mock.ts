import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';

export function registerMockTools(server: McpServer, config: AppConfig) {
  // 1. Dedicated test_connection tool
  server.tool(
    'test_connection',
    'Test connectivity between Gemini Spark / Gemini AI and the Moon-Link MCP Server',
    {
      client_name: z.string().optional().describe('Name of the calling AI client or user (optional)')
    },
    async ({ client_name }) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'CONNECTED',
                service: 'Moon-Link Discord MCP Server (Test / Simulation Mode)',
                greeting: `Hello ${client_name || 'Gemini Spark'}! MCP connection established successfully.`,
                serverHost: 'AWS EC2 Ubuntu (18.142.95.204)',
                transport: (config.transport || 'sse').toUpperCase(),
                mode: 'SIMULATION / SAFE TEST (Real Discord credentials not yet connected)',
                timestamp: new Date().toISOString(),
                instructions:
                  'All tools are active in test/simulation mode. You can test get_server_info, list_channels, send_message, list_members, etc. Once you want to manage your real Discord server, add your DISCORD_BOT_TOKEN to .env.'
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  // 2. Mock get_server_info
  server.tool(
    'get_server_info',
    '[TEST MODE] Get information and statistics about the simulated Discord server',
    {
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: '[TEST / MOCK SERVER]',
                id: '123456789012345678',
                name: 'Moon-Link Test Guild',
                description: 'Private Discord Server (Simulated for Gemini Spark connection testing)',
                ownerId: '100000000000000001',
                memberCount: 42,
                channelCount: 7,
                roleCount: 5,
                verificationLevel: 'HIGH',
                premiumTier: 'TIER_2',
                createdAt: '2024-01-01T00:00:00.000Z'
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  // 3. Mock list_channels
  server.tool(
    'list_channels',
    '[TEST MODE] List channels in the simulated Discord server',
    {
      type: z.enum(['all', 'text', 'voice', 'category']).optional()
    },
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              [
                { id: '100000000000000010', name: '📢-announcements', type: 'GuildAnnouncement', position: 0 },
                { id: '100000000000000011', name: '💬-general', type: 'GuildText', topic: 'General discussion', position: 1 },
                { id: '100000000000000012', name: '🤖-bot-commands', type: 'GuildText', topic: 'Testing bot commands', position: 2 },
                { id: '100000000000000013', name: '🔒-vip-lounge', type: 'GuildText', topic: 'Private VIP discussion', position: 3 },
                { id: '100000000000000014', name: '🔊 General Voice', type: 'GuildVoice', position: 4 }
              ],
              null,
              2
            )
          }
        ]
      };
    }
  );

  // 4. Mock send_message
  server.tool(
    'send_message',
    '[TEST MODE] Simulate sending a message to a Discord channel',
    {
      channel_id: z.string().describe('Target Channel Name or ID'),
      content: z.string().optional().describe('Message text content')
    },
    async ({ channel_id, content }) => {
      return {
        content: [
          {
            type: 'text',
            text: `[SIMULATION] Message sent successfully to Channel ${channel_id}!\nSimulated Message ID: 999999999999999999\nContent: "${content || '(empty)'}"\nTimestamp: ${new Date().toISOString()}`
          }
        ]
      };
    }
  );

  // 5. Mock read_channel_messages
  server.tool(
    'read_channel_messages',
    '[TEST MODE] Read simulated recent messages from a channel',
    {
      channel_id: z.string().describe('Channel Name or ID (e.g. "mainframe-channel" or snowflake ID)'),
      limit: z.number().optional().default(10)
    },
    async ({ channel_id }) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              [
                {
                  id: '999999999999999991',
                  channelId: channel_id,
                  author: { username: 'AdminUser', displayName: 'Administrator', bot: false },
                  content: 'Welcome to the Moon-Link test server!',
                  createdAt: new Date(Date.now() - 3600000).toISOString()
                },
                {
                  id: '999999999999999992',
                  channelId: channel_id,
                  author: { username: 'MoonLinkBot', displayName: 'Moon Link Bot', bot: true },
                  content: 'Moon-Link MCP is connected and ready for management.',
                  createdAt: new Date(Date.now() - 1800000).toISOString()
                }
              ],
              null,
              2
            )
          }
        ]
      };
    }
  );

  // 6. Mock list_roles
  server.tool(
    'list_roles',
    '[TEST MODE] List simulated roles in the server',
    {},
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              [
                { id: '200000000000000001', name: 'Server Owner', colorHex: '#E91E63', position: 4, memberCount: 1 },
                { id: '200000000000000002', name: 'Administrator', colorHex: '#9B59B6', position: 3, memberCount: 3 },
                { id: '200000000000000003', name: 'Moderator', colorHex: '#3498DB', position: 2, memberCount: 5 },
                { id: '200000000000000004', name: 'VIP Member', colorHex: '#F1C40F', position: 1, memberCount: 12 },
                { id: '200000000000000000', name: '@everyone', colorHex: '#000000', position: 0, memberCount: 42 }
              ],
              null,
              2
            )
          }
        ]
      };
    }
  );

  // 7. Mock list_members
  server.tool(
    'list_members',
    '[TEST MODE] List simulated members in the server',
    {
      limit: z.number().optional().default(10)
    },
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              [
                { id: '100000000000000001', username: 'ServerOwner', displayName: 'Guild Master', roles: ['Server Owner'] },
                { id: '100000000000000002', username: 'GeminiTester', displayName: 'Gemini Spark Tester', roles: ['Administrator'] },
                { id: '100000000000000003', username: 'CommunityMod', displayName: 'Mod Squad', roles: ['Moderator'] }
              ],
              null,
              2
            )
          }
        ]
      };
    }
  );
}
