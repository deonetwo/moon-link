import { loadConfig } from '../src/config.js';
import { initDiscordClient, resolveTextChannel } from '../src/discord.js';

async function main() {
  const config = loadConfig();
  await initDiscordClient(config);
  const channel = await resolveTextChannel(config.mainframeChannel || 'mainframe-channel');
  console.log(`Channel: #${channel.name} (${channel.id})`);

  const messages = await channel.messages.fetch({ limit: 50 });
  console.log(`Total messages in channel: ${messages.size}`);
  for (const [id, msg] of messages) {
    console.log(`- [${id}] ${msg.author.tag} (${msg.createdAt.toISOString()}): ${JSON.stringify(msg.content.slice(0, 80))}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
