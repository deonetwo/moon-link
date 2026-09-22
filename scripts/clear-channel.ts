import { Collection, Message } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { initDiscordClient, resolveTextChannel } from '../src/discord.js';

async function main() {
  const channelIdentifier = process.argv[2] || 'mainframe-channel';
  const keepCurrentMessageId = process.argv[3]; // Optional message ID to spare

  console.log(`\n--- Clearing channel: #${channelIdentifier} ---\n`);

  const config = loadConfig();
  await initDiscordClient(config);
  const channel = await resolveTextChannel(channelIdentifier);

  console.log(`Resolved channel: #${channel.name} (${channel.id})`);

  let totalPurged = 0;
  let hasMore = true;

  while (hasMore) {
    const fetched: Collection<string, Message> = await channel.messages.fetch({ limit: 100 });
    if (fetched.size === 0) break;

    // Filter out keepCurrentMessageId if specified
    const toDelete = keepCurrentMessageId 
      ? fetched.filter(m => m.id !== keepCurrentMessageId)
      : fetched;

    if (toDelete.size === 0) {
      break;
    }

    if (toDelete.size === 1) {
      await toDelete.first()?.delete();
      totalPurged += 1;
      break;
    }

    const deleted = await channel.bulkDelete(toDelete, true);
    totalPurged += deleted.size;

    console.log(`Purged batch: ${deleted.size} messages.`);

    // If bulkDelete deleted fewer than requested (e.g. messages > 14 days), delete individually
    if (deleted.size < toDelete.size) {
      const remaining = toDelete.filter(m => !deleted.has(m.id));
      for (const msg of remaining.values()) {
        try {
          await msg.delete();
          totalPurged += 1;
        } catch (err: any) {
          console.error(`Failed to delete message ${msg.id}:`, err.message);
        }
      }
    }

    if (fetched.size < 100) {
      hasMore = false;
    }
  }

  console.log(`\n🎉 Successfully cleared ${totalPurged} messages from #${channel.name}!\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Failed to clear channel:', err.message);
  process.exit(1);
});
