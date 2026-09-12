import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  GuildMember,
  Message,
  Partials,
  Role,
  TextBasedChannel
} from 'discord.js';
import { AppConfig } from './config.js';
import { resolveGuildId, validateSnowflake } from './security.js';

let discordClient: Client | null = null;
let clientConfig: AppConfig | null = null;

/**
 * Initializes and connects the Discord.js Client with necessary Gateway Intents
 */
export async function initDiscordClient(config: AppConfig): Promise<Client> {
  if (discordClient && discordClient.isReady()) {
    return discordClient;
  }

  if (!config.discordToken) {
    throw new Error('DISCORD_BOT_TOKEN is missing. Please provide it in your .env file or environment.');
  }

  clientConfig = config;

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildEmojisAndStickers
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.GuildMember,
      Partials.User
    ]
  });

  return new Promise((resolve, reject) => {
    if (!discordClient) return reject(new Error('Discord client failed to allocate'));

    discordClient.once('ready', (readyClient) => {
      console.error(`[Discord] Bot connected successfully as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
      resolve(readyClient);
    });

    discordClient.on('error', (err) => {
      console.error('[Discord] Client error:', err.message);
    });

    discordClient.on('warn', (warning) => {
      console.error('[Discord] Client warning:', warning);
    });

    discordClient.login(config.discordToken).catch((err) => {
      console.error('[Discord] Login failed:', err.message);
      reject(err);
    });
  });
}

export function getClient(): Client {
  if (!discordClient || !discordClient.isReady()) {
    throw new Error('Discord client is not ready. Ensure bot token is valid and client is connected.');
  }
  return discordClient;
}

/**
 * Resolves a Discord Guild while enforcing allowed guild boundaries
 */
export async function resolveGuild(providedGuildId?: string): Promise<Guild> {
  if (!clientConfig) {
    throw new Error('Client configuration not initialized.');
  }

  const guildId = resolveGuildId(providedGuildId, clientConfig);
  const client = getClient();

  let guild = client.guilds.cache.get(guildId);
  if (!guild) {
    try {
      guild = await client.guilds.fetch(guildId);
    } catch {
      throw new Error(`Guild with ID "${guildId}" not found or bot has not been invited to it.`);
    }
  }

  return guild;
}

/**
 * Retrieves the GuildMember representing this bot in the target guild
 */
export async function getBotMember(guild: Guild): Promise<GuildMember> {
  const client = getClient();
  if (!client.user) throw new Error('Client user not defined');
  return guild.members.fetch(client.user.id);
}

/**
 * Resolves a channel within a guild and validates ownership
 */
export async function resolveChannel(channelId: string, guildId?: string): Promise<GuildBasedChannel> {
  const validChannelId = validateSnowflake(channelId, 'channelId');
  const guild = await resolveGuild(guildId);

  let channel = guild.channels.cache.get(validChannelId);
  if (!channel) {
    const fetched = await guild.channels.fetch(validChannelId).catch(() => null);
    if (!fetched) {
      throw new Error(`Channel "${validChannelId}" not found in server "${guild.name}" (${guild.id}).`);
    }
    channel = fetched;
  }

  return channel;
}

/**
 * Resolves a text-based channel (text, announcement, voice text, thread)
 */
export async function resolveTextChannel(channelId: string, guildId?: string): Promise<TextBasedChannel & GuildBasedChannel> {
  const channel = await resolveChannel(channelId, guildId);
  if (!channel.isTextBased()) {
    throw new Error(`Channel "${channel.name}" (${channel.id}) is not a text-capable channel (type: ${ChannelType[channel.type]}).`);
  }
  return channel as TextBasedChannel & GuildBasedChannel;
}

/**
 * Resolves a GuildMember by ID
 */
export async function resolveMember(userId: string, guildId?: string): Promise<GuildMember> {
  const validUserId = validateSnowflake(userId, 'userId');
  const guild = await resolveGuild(guildId);

  try {
    return await guild.members.fetch(validUserId);
  } catch {
    throw new Error(`Member with ID "${validUserId}" not found in server "${guild.name}".`);
  }
}

/**
 * Resolves a Role by ID
 */
export async function resolveRole(roleId: string, guildId?: string): Promise<Role> {
  const validRoleId = validateSnowflake(roleId, 'roleId');
  const guild = await resolveGuild(guildId);

  const role = guild.roles.cache.get(validRoleId) || (await guild.roles.fetch(validRoleId).catch(() => null));
  if (!role) {
    throw new Error(`Role with ID "${validRoleId}" not found in server "${guild.name}".`);
  }
  return role;
}

// ================= Formatting Helpers =================

export function formatGuild(guild: Guild) {
  return {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    approximateMemberCount: guild.approximateMemberCount,
    approximatePresenceCount: guild.approximatePresenceCount,
    createdAt: guild.createdAt.toISOString(),
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    verificationLevel: guild.verificationLevel,
    premiumTier: guild.premiumTier,
    premiumSubscriptionCount: guild.premiumSubscriptionCount,
    vanityURLCode: guild.vanityURLCode,
    rulesChannelId: guild.rulesChannelId,
    systemChannelId: guild.systemChannelId
  };
}

export function formatChannel(channel: GuildBasedChannel) {
  return {
    id: channel.id,
    name: channel.name,
    type: ChannelType[channel.type] || String(channel.type),
    parentId: channel.parentId,
    position: 'position' in channel ? (channel as any).position : 0,
    isNsfw: 'nsfw' in channel ? (channel as any).nsfw : false,
    topic: 'topic' in channel ? (channel as any).topic : null,
    rateLimitPerUser: 'rateLimitPerUser' in channel ? (channel as any).rateLimitPerUser : 0
  };
}

export function formatRole(role: Role) {
  return {
    id: role.id,
    name: role.name,
    colorHex: role.hexColor,
    position: role.position,
    hoist: role.hoist,
    managed: role.managed,
    mentionable: role.mentionable,
    memberCount: role.members.size,
    permissions: role.permissions.toArray()
  };
}

export function formatMember(member: GuildMember) {
  return {
    id: member.id,
    user: {
      username: member.user.username,
      discriminator: member.user.discriminator,
      displayName: member.user.displayName,
      tag: member.user.tag,
      bot: member.user.bot,
      createdAt: member.user.createdAt.toISOString()
    },
    nickname: member.nickname,
    displayName: member.displayName,
    joinedAt: member.joinedAt?.toISOString() || null,
    roles: member.roles.cache
      .filter((r) => r.id !== member.guild.id)
      .map((r) => ({ id: r.id, name: r.name, colorHex: r.hexColor })),
    isServerOwner: member.id === member.guild.ownerId,
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() || null,
    permissions: member.permissions.toArray()
  };
}

export function formatMessage(msg: Message) {
  return {
    id: msg.id,
    channelId: msg.channelId,
    author: {
      id: msg.author.id,
      username: msg.author.username,
      displayName: msg.author.displayName,
      bot: msg.author.bot
    },
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
    editedAt: msg.editedAt?.toISOString() || null,
    pinned: msg.pinned,
    reference: msg.reference ? { messageId: msg.reference.messageId } : null,
    attachments: msg.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      url: a.url,
      size: a.size
    })),
    embedsCount: msg.embeds.length,
    reactions: msg.reactions.cache.map((r) => ({
      emoji: r.emoji.name,
      count: r.count
    }))
  };
}
