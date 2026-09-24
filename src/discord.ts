import {
  ChannelType,
  Client,
  DiscordAPIError,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  GuildMember,
  Message,
  Partials,
  RateLimitData,
  Role,
  TextBasedChannel
} from 'discord.js';
import { AppConfig } from './config.js';
import { resolveGuildId, validateSnowflake } from './security.js';

let discordClient: Client | null = null;
let clientConfig: AppConfig | null = null;

/**
 * Initializes the Discord.js Client with strictly necessary Gateway Intents
 * for channel and message management.
 */
export async function initDiscordClient(config: AppConfig): Promise<Client> {
  if (discordClient && discordClient.isReady()) {
    return discordClient;
  }

  if (!config.discordToken) {
    throw new Error('DISCORD_BOT_TOKEN is not configured in process.env or .env file.');
  }

  clientConfig = config;

  // Minimal Gateway Intents strictly required for operations
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.User
    ]
  });

  // REST API Rate limit event monitoring
  discordClient.rest.on('rateLimited', (rateLimitData: RateLimitData) => {
    console.error(
      `[Discord] ⚠️ REST Rate limit encountered! Route: ${rateLimitData.route} | ` +
      `Timeout: ${rateLimitData.timeToReset}ms | Global: ${rateLimitData.global} | Limit: ${rateLimitData.limit}`
    );
  });

  return new Promise((resolve, reject) => {
    if (!discordClient) return reject(new Error('Discord client failed to allocate.'));

    discordClient.once('ready', (readyClient) => {
      console.error(`[Discord] Bot connected successfully as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
      resolve(readyClient);
    });

    discordClient.on('error', (err) => {
      console.error('[Discord] Client network error:', err.message);
    });

    discordClient.on('warn', (warning) => {
      console.error('[Discord] Client warning:', warning);
    });

    discordClient.login(config.discordToken).catch((err) => {
      console.error('[Discord] Authentication failed:', err.message);
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
 * Translates Discord API errors into clean, structured messages to ensure
 * unhandled exceptions or rejected promises never crash the MCP process.
 */
export function formatDiscordApiError(err: any, actionContext: string): string {
  if (err instanceof DiscordAPIError) {
    switch (err.code) {
      case 50013:
        return `Discord Permission Error during ${actionContext}: Missing Permissions. Ensure the bot's role has the required permissions and is positioned high enough in Server Settings > Roles.`;
      case 50001:
        return `Discord Access Error during ${actionContext}: Missing Access. The bot cannot see or access the target channel/guild.`;
      case 10003:
        return `Discord Not Found Error during ${actionContext}: Unknown Channel. The specified channel ID does not exist in this server.`;
      case 10008:
        return `Discord Not Found Error during ${actionContext}: Unknown Message. The specified message ID does not exist or was deleted.`;
      case 10014:
        return `Discord Not Found Error during ${actionContext}: Unknown Emoji. Custom emoji could not be resolved.`;
      case 40005:
        return `Discord Payload Error during ${actionContext}: Request entity too large (exceeded Discord upload/message limits).`;
      case 429:
        return `Discord Rate Limit Error during ${actionContext}: Request throttled by Discord. Please retry after backoff.`;
      default:
        return `Discord API Error [${err.code}] during ${actionContext}: ${err.message}`;
    }
  }

  if (err.status === 429) {
    return `Discord Rate Limit (429) during ${actionContext}: Exceeded API rate limits.`;
  }

  return `Error during ${actionContext}: ${err instanceof Error ? err.message : String(err)}`;
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
    } catch (err) {
      throw new Error(formatDiscordApiError(err, `fetch guild "${guildId}"`));
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
  try {
    return await guild.members.fetch(client.user.id);
  } catch (err) {
    throw new Error(formatDiscordApiError(err, 'fetch bot guild member'));
  }
}

/**
 * Resolves a channel within a guild by Snowflake ID or channel name.
 * Accepts:
 * - Snowflake ID (e.g. "1550706214629806221")
 * - Mention syntax (e.g. "<#1550706214629806221>")
 * - Channel name / slug (e.g. "bot-commands", "#bot-commands", "bot commands")
 */
export async function resolveChannel(channelIdentifier: string, guildId?: string): Promise<GuildBasedChannel> {
  if (!channelIdentifier || typeof channelIdentifier !== 'string' || !channelIdentifier.trim()) {
    throw new Error('A valid channel ID or channel name must be provided.');
  }

  const raw = channelIdentifier.trim();
  const guild = await resolveGuild(guildId);

  // 1. Check for Discord mention format: <#123456789012345678>
  const mentionMatch = raw.match(/^<#(\d{17,20})>$/);
  const candidateId = mentionMatch ? mentionMatch[1] : raw;

  // 2. If it's a numeric snowflake ID, try fetching/getting by ID
  const SNOWFLAKE_REGEX = /^\d{17,20}$/;
  if (SNOWFLAKE_REGEX.test(candidateId)) {
    const cached = guild.channels.cache.get(candidateId);
    if (cached) return cached;

    try {
      const fetched = await guild.channels.fetch(candidateId);
      if (fetched) return fetched;
    } catch (err: any) {
      if (err.code !== 10003 && err.code !== 50001 && err.status !== 404) {
        throw new Error(formatDiscordApiError(err, `fetch channel "${candidateId}"`));
      }
    }
  }

  // 3. Resolve by channel name
  const cleanName = raw.startsWith('#') ? raw.slice(1).trim() : raw;
  const targetLower = cleanName.toLowerCase();
  const targetNormalized = targetLower.replace(/\s+/g, '-');
  const targetStripped = targetLower.replace(/[-_ ]/g, '');

  const findBestMatch = (channelList: GuildBasedChannel[]) => {
    // Exact name match (case-insensitive)
    let matches = channelList.filter(c => c.name.toLowerCase() === targetLower);

    // Hyphenated match (e.g. "bot commands" -> "bot-commands")
    if (matches.length === 0) {
      matches = channelList.filter(c => c.name.toLowerCase() === targetNormalized);
    }

    // Stripped match (ignoring dashes, underscores, spaces)
    if (matches.length === 0) {
      matches = channelList.filter(c => c.name.toLowerCase().replace(/[-_ ]/g, '') === targetStripped);
    }

    // Stripped leading emoji / special characters match (e.g. "💬-bot-commands" -> "bot-commands")
    if (matches.length === 0) {
      matches = channelList.filter(c => {
        const strippedPrefix = c.name.toLowerCase().replace(/^[^\w\d]+/, '');
        return strippedPrefix === targetLower || strippedPrefix === targetNormalized;
      });
    }

    // Substring / partial match if search term is at least 3 characters
    if (matches.length === 0 && targetLower.length >= 3) {
      matches = channelList.filter(c =>
        c.name.toLowerCase().includes(targetNormalized) || targetNormalized.includes(c.name.toLowerCase())
      );
    }

    if (matches.length === 0) return null;

    // Prioritize text-based channels if multiple matches exist
    const textMatch = matches.find(c => c.isTextBased());
    return textMatch || matches[0];
  };

  // Check cache first
  const cachedChannels = Array.from(guild.channels.cache.values()).filter(Boolean) as GuildBasedChannel[];
  let matched = findBestMatch(cachedChannels);
  if (matched) return matched;

  // If not found in cache, fetch fresh list from Discord API
  try {
    const fetchedMap = await guild.channels.fetch();
    const freshChannels = Array.from(fetchedMap.values()).filter(Boolean) as GuildBasedChannel[];
    matched = findBestMatch(freshChannels);
    if (matched) return matched;

    const availableText = freshChannels
      .filter(c => c.isTextBased())
      .map(c => `#${c.name}`)
      .slice(0, 15)
      .join(', ');

    throw new Error(
      `Channel "${channelIdentifier}" not found in server "${guild.name}" (${guild.id}). ` +
      `Available text channels: ${availableText || '(none)'}`
    );
  } catch (err: any) {
    if (err.message.includes('not found in server')) {
      throw err;
    }
    throw new Error(formatDiscordApiError(err, `fetch channels in guild "${guild.name}"`));
  }
}

/**
 * Resolves a text-based channel (text, announcement, voice text, thread)
 */
export async function resolveTextChannel(channelId: string, guildId?: string): Promise<TextBasedChannel & GuildBasedChannel> {
  const channel = await resolveChannel(channelId, guildId);
  if (!channel.isTextBased()) {
    throw new Error(`Channel #${channel.name} (${channel.id}) is not a text-capable channel (type: ${ChannelType[channel.type]}).`);
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
  } catch (err) {
    throw new Error(formatDiscordApiError(err, `fetch member "${validUserId}"`));
  }
}

/**
 * Resolves a Role by ID
 */
export async function resolveRole(roleId: string, guildId?: string): Promise<Role> {
  const validRoleId = validateSnowflake(roleId, 'roleId');
  const guild = await resolveGuild(guildId);

  let role = guild.roles.cache.get(validRoleId);
  if (!role) {
    try {
      const fetched = await guild.roles.fetch(validRoleId);
      if (!fetched) {
        throw new Error(`Role with ID "${validRoleId}" not found in server "${guild.name}".`);
      }
      role = fetched;
    } catch (err) {
      throw new Error(formatDiscordApiError(err, `fetch role "${validRoleId}"`));
    }
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
