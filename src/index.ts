import { loadConfig, maskToken } from './config.js';
import { getClient, initDiscordClient } from './discord.js';
import { runSseServer } from './transports/sse.js';
import { runStdioServer } from './transports/stdio.js';

async function main() {
  const config = loadConfig();

  console.error('=====================================================');
  console.error('          MOON-LINK DISCORD MCP SERVER               ');
  console.error('=====================================================');
  console.error(`Mode: ${config.mockMode ? 'SIMULATION / TEST (Mock Mode)' : 'LIVE DISCORD'}`);
  console.error(`Transport: ${config.transport.toUpperCase()}`);
  if (config.mockMode) {
    console.error('Info: Running in test mode. No Discord bot token required!');
  } else {
    console.error(`Default Guild: ${config.defaultGuildId || '(None specified)'}`);
    console.error(`Allowed Guilds: ${config.allowedGuildIds.length > 0 ? config.allowedGuildIds.join(', ') : '(None - will require valid ID)'}`);
    console.error(`Confirmation Guardrails: ${config.requireConfirmation ? 'ON (Destructive actions require confirm: true)' : 'OFF'}`);
    console.error(`Discord Bot Token: ${maskToken(config.discordToken)}`);
  }
  console.error('=====================================================');

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.error(`\n[MCP] Received ${signal}. Shutting down gracefully...`);
    if (!config.mockMode) {
      try {
        const client = getClient();
        await client.destroy();
        console.error('[Discord] Bot disconnected.');
      } catch {
        // client may not have initialized
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    if (!config.mockMode) {
      // Connect Discord Bot Gateway
      console.error('[Discord] Logging into Discord Gateway...');
      await initDiscordClient(config);
    }

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
