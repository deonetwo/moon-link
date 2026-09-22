import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { getBotMember, initDiscordClient, resolveGuild } from '../src/discord.js';
import { validateBotPermissions } from '../src/security.js';

async function main() {
  const channelName = process.argv[2] || 'mainframe-channel';
  console.log(`\n--- Creating Discord Channel: #${channelName} ---\n`);

  const config = loadConfig();
  await initDiscordClient(config);

  const guild = await resolveGuild(config.defaultGuildId);
  console.log(`Connected to Guild: "${guild.name}" (${guild.id})`);

  const botMember = await getBotMember(guild);
  validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageChannels], 'create_channel');

  // Check if channel already exists
  const channels = await guild.channels.fetch();
  const existing = channels.find(c => c && c.name.toLowerCase() === channelName.toLowerCase());

  if (existing) {
    console.log(`⚠️ Channel #${channelName} already exists! ID: ${existing.id}`);
    process.exit(0);
  }

  const created = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: 'Mainframe operations and bot communication channel'
  });

  console.log(`🎉 Channel created successfully!`);
  console.log(`   - Name: #${created.name}`);
  console.log(`   - ID: ${created.id}`);
  console.log(`   - Type: ${ChannelType[created.type]}`);
  console.log(`   - Topic: ${created.topic || '(none)'}`);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Failed to create channel:', err.message);
  process.exit(1);
});
