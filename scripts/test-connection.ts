import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import dotenv from 'dotenv';
import { maskToken } from '../src/config.js';

dotenv.config();

async function runDiagnostic() {
  console.log('\n=====================================================');
  console.log('   MOON-LINK DISCORD MCP CONNECTION DIAGNOSTIC       ');
  console.log('=====================================================\n');

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const allowedGuilds = process.env.ALLOWED_GUILD_IDS;

  console.log(`[Config] Bot Token: ${maskToken(token)}`);
  console.log(`[Config] Target Server ID: ${guildId || '(Not configured)'}`);
  console.log(`[Config] Allowed Server IDs: ${allowedGuilds || '(Inherits default)'}\n`);

  if (!token) {
    console.error('❌ DISCORD_BOT_TOKEN is missing in .env!');
    console.error('Please configure your bot token before testing.');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessageReactions
    ]
  });

  console.log('⏳ Connecting to Discord Gateway...');

  try {
    await client.login(token);
    console.log(`✅ Logged in successfully as: ${client.user?.tag} (ID: ${client.user?.id})`);

    const guilds = await client.guilds.fetch();
    console.log(`✅ Bot is currently in ${guilds.size} server(s):`);
    for (const [id, oAuth2Guild] of guilds) {
      console.log(`   - "${oAuth2Guild.name}" (ID: ${id})`);
    }

    if (!guildId) {
      console.warn('\n⚠️ DISCORD_GUILD_ID is not configured in .env!');
      console.warn('Copy one of the Server IDs above and set DISCORD_GUILD_ID in your .env file.\n');
    } else {
      console.log(`\n🔍 Verifying access to target guild: ${guildId}...`);
      const targetGuild = await client.guilds.fetch(guildId).catch(() => null);

      if (!targetGuild) {
        console.error(`❌ Bot cannot access Guild ID "${guildId}".`);
        console.error('Make sure the bot has been invited to this server with appropriate scopes.');
      } else {
        console.log(`✅ Target Guild Found: "${targetGuild.name}"`);
        const fullGuild = await targetGuild.fetch();
        const botMember = await fullGuild.members.fetch(client.user!.id);

        console.log(`\n🛡️ Bot Permissions in "${targetGuild.name}":`);
        const checks = [
          { name: 'Administrator (Superuser)', flag: PermissionFlagsBits.Administrator },
          { name: 'Manage Channels', flag: PermissionFlagsBits.ManageChannels },
          { name: 'Manage Roles', flag: PermissionFlagsBits.ManageRoles },
          { name: 'Kick Members', flag: PermissionFlagsBits.KickMembers },
          { name: 'Ban Members', flag: PermissionFlagsBits.BanMembers },
          { name: 'Moderate Members (Timeout)', flag: PermissionFlagsBits.ModerateMembers },
          { name: 'Send Messages', flag: PermissionFlagsBits.SendMessages },
          { name: 'Read Message History', flag: PermissionFlagsBits.ReadMessageHistory },
          { name: 'Manage Messages', flag: PermissionFlagsBits.ManageMessages },
          { name: 'View Audit Log', flag: PermissionFlagsBits.ViewAuditLog },
          { name: 'Create Instant Invite', flag: PermissionFlagsBits.CreateInstantInvite }
        ];

        for (const check of checks) {
          const has = botMember.permissions.has(check.flag);
          console.log(`   ${has ? '✅' : '⚠️'} ${check.name}: ${has ? 'Granted' : 'MISSING'}`);
        }

        console.log(`\nBot Highest Role: "${botMember.roles.highest.name}" (Position: ${botMember.roles.highest.position})`);
        if (botMember.roles.highest.position === 1) {
          console.warn('⚠️ Note: To moderate members or manage other roles, drag the bot role higher up in Server Settings > Roles.');
        }
      }
    }

    console.log('\n=====================================================');
    console.log('✅ Diagnostic complete! Everything looks good.');
    console.log('=====================================================\n');
  } catch (err: any) {
    console.error('\n❌ Connection test failed:', err.message);
    if (err.code === 'DisallowedIntents') {
      console.error('\n⚠️ Privileged Gateway Intents Error:');
      console.error('You need to enable "Server Members Intent" and "Message Content Intent" in Discord Developer Portal:');
      console.error('1. Visit https://discord.com/developers/applications');
      console.error('2. Select your Bot Application');
      console.error('3. Click "Bot" in the left sidebar');
      console.error('4. Scroll down to "Privileged Gateway Intents"');
      console.error('5. Check "PRESENCE INTENT" (optional), "SERVER MEMBERS INTENT" (required), "MESSAGE CONTENT INTENT" (required)');
      console.error('6. Click "Save Changes" and re-run this test.');
    }
  } finally {
    await client.destroy();
    process.exit(0);
  }
}

runDiagnostic();
