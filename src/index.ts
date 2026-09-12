import { loadConfig, maskToken } from './config.js';
import { getClient, initDiscordClient } from './discord.js';
import { runSseServer } from './transports/sse.js';
import { runStdioServer } from './transports/stdio.js';

async function main() {
  const config = loadConfig();

  console.error('=====================================================');
  console.error('          MOON-LINK DISCORD MCP SERVER               ');
  console.error('=====================================================');
  console.error(`Mode: ${config.transport.toUpperCase()}`);
  console.error(`Default Guild: ${config.defaultGuildId || '(None specified)'}`);
  console.error(`Allowed Guilds: ${config.allowedGuildIds.length > 0 ? config.allowedGuildIds.join(', ') : '(None - will require valid ID)'}`);
  console.error(`Confirmation Guardrails: ${config.requireConfirmation ? 'ON (Destructive actions require confirm: true)' : 'OFF'}`);
  console.error(`Discord Bot Token: ${maskToken(config.discordToken)}`);
  console.error('=====================================================');

  if (!config.discordToken) {
    console.error('[Error] DISCORD_BOT_TOKEN is not set in environment or .env!');
    console.error('Please create a .env file based on .env.example with your Discord bot token.');
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.error(`\n[MCP] Received ${signal}. Shutting down gracefully...`);
    try {
      const client = getClient();
      await client.destroy();
      console.error('[Discord] Bot disconnected.');
    } catch {
      // client may not have initialized
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Connect Discord Bot Gateway first
    console.error('[Discord] Logging into Discord Gateway...');
    await initDiscordClient(config);

    // Run the requested transport
    if (config.transport === 'sse') {
      await runSseServer(config);
    } else {
      await runStdioServer(config);
    }
  } catch (err: any) {
    console.error('[Fatal Error] Failed to start MCP server:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
