import { loadConfig, maskSecret } from './config.js';
import { getClient, initDiscordClient } from './discord.js';
import { runSseServer } from './transports/sse.js';

// =========================================================================
// Global Process Fault Tolerance
// Prevents unhandled async rejections or exceptions from crashing the daemon
// =========================================================================
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Process Guard] ⚠️ Intercepted unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err: Error) => {
  console.error('[Process Guard] ⚠️ Intercepted uncaught exception:', err.message, err.stack);
});

async function main() {
  const config = loadConfig();

  console.error('=============================================================');
  console.error('     MOON-LINK DISCORD MCP SERVER (PRODUCTION BACKEND)       ');
  console.error('=============================================================');
  console.error(`  Transport:               REMOTE SSE (Server-Sent Events)`);
  console.error(`  Listening Host/Port:     ${config.host}:${config.port}`);
  console.error(`  Default Server ID:       ${config.defaultGuildId || '(None specified)'}`);
  console.error(`  Allowed Server IDs:      ${config.allowedGuildIds.length > 0 ? config.allowedGuildIds.join(', ') : '(None)'}`);
  console.error(`  Action Confirmations:    ${config.requireConfirmation ? 'ENFORCED (confirm: true required for destructive tools)' : 'DISABLED'}`);
  console.error(`  MCP Auth Token:          ${maskSecret(config.authToken)}`);
  console.error(`  Discord Bot Token:       ${maskSecret(config.discordToken)}`);
  console.error('=============================================================');

  // Strict validation of production secrets - zero hardcoded credentials
  if (!config.authToken) {
    console.error('\n❌ FATAL: MCP_AUTH_TOKEN is missing!');
    console.error('All publicly exposed MCP endpoints must be guarded with a secure authentication token.');
    console.error('Please configure MCP_AUTH_TOKEN in your .env file or environment.\n');
    process.exit(1);
  }

  if (!config.discordToken) {
    console.error('\n❌ FATAL: DISCORD_BOT_TOKEN is missing!');
    console.error('Please configure your bot token in .env before starting the server.\n');
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.error(`\n[Server] Received ${signal}. Terminating gracefully...`);
    try {
      const client = getClient();
      await client.destroy();
      console.error('[Discord] Gateway connection terminated.');
    } catch {
      // Client may not be connected
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // 1. Connect Discord Bot Gateway with fault tolerance
    console.error('[Discord] Connecting to Discord Gateway...');
    await initDiscordClient(config);

    // 2. Launch production remote SSE transport
    console.error('[MCP] Starting remote SSE server...');
    await runSseServer(config);
  } catch (err: any) {
    console.error('[Fatal Error] Failed to initialize server:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
