import { Guild, GuildMember, PermissionResolvable, PermissionsBitField, Role } from 'discord.js';
import { AppConfig } from './config.js';

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(action: string, targetDescription: string) {
    super(
      `SAFETY ABORT: Destructive action "${action}" on ${targetDescription} requires explicit confirmation. ` +
      `To proceed, invoke the tool again with parameter "confirm: true".`
    );
    this.name = 'ConfirmationRequiredError';
  }
}

/**
 * Validates that an ID is a valid Discord Snowflake (17 to 20 digits).
 */
export function validateSnowflake(id: string, fieldName: string): string {
  if (!id || typeof id !== 'string' || !SNOWFLAKE_REGEX.test(id.trim())) {
    throw new SecurityError(
      `Invalid ${fieldName}: "${id}". Expected a valid Discord Snowflake ID (17-20 digits).`
    );
  }
  return id.trim();
}

/**
 * Resolves and validates the target Guild ID against allowed guilds.
 */
export function resolveGuildId(providedGuildId: string | undefined, config: AppConfig): string {
  const targetGuild = providedGuildId ? validateSnowflake(providedGuildId, 'guildId') : config.defaultGuildId;

  if (!targetGuild) {
    throw new SecurityError(
      'No Discord Guild ID provided, and no default DISCORD_GUILD_ID is configured in .env.'
    );
  }

  if (config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(targetGuild)) {
    throw new SecurityError(
      `Access Denied: Guild ID "${targetGuild}" is not in the allowed servers whitelist. ` +
      `Allowed guilds: [${config.allowedGuildIds.join(', ')}].`
    );
  }

  return targetGuild;
}

/**
 * Ensures destructive actions require confirm: true
 */
export function enforceConfirmation(
  action: string,
  targetDescription: string,
  confirm: boolean | undefined,
  config: AppConfig
): void {
  if (config.requireConfirmation && confirm !== true) {
    throw new ConfirmationRequiredError(action, targetDescription);
  }
}

/**
 * Validates bot hierarchy against target member before moderating (kick, ban, timeout, nickname, etc.)
 */
export function validateMemberHierarchy(
  botMember: GuildMember,
  targetMember: GuildMember,
  actionName: string
): void {
  if (targetMember.id === targetMember.guild.ownerId) {
    throw new SecurityError(`Cannot perform "${actionName}" on the server owner (${targetMember.user.tag}).`);
  }

  if (targetMember.id === botMember.id) {
    throw new SecurityError(`Cannot perform "${actionName}" on the bot itself.`);
  }

  if (botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
    throw new SecurityError(
      `Role Hierarchy Error: Cannot perform "${actionName}" on ${targetMember.user.tag}. ` +
      `Their highest role (${targetMember.roles.highest.name}) is equal to or higher than the bot's highest role (${botMember.roles.highest.name}). ` +
      `Move the bot's role higher in Server Settings > Roles.`
    );
  }
}

/**
 * Validates bot hierarchy against a target role before modifying, assigning, or deleting it
 */
export function validateRoleHierarchy(
  botMember: GuildMember,
  targetRole: Role,
  actionName: string
): void {
  if (targetRole.id === targetRole.guild.id) {
    throw new SecurityError(`Cannot modify or delete the @everyone role.`);
  }

  if (targetRole.managed) {
    throw new SecurityError(
      `Cannot perform "${actionName}" on role "${targetRole.name}" because it is managed by an integration/bot.`
    );
  }

  if (botMember.roles.highest.comparePositionTo(targetRole) <= 0) {
    throw new SecurityError(
      `Role Hierarchy Error: Cannot perform "${actionName}" on role "${targetRole.name}". ` +
      `The role is equal to or higher than the bot's highest role (${botMember.roles.highest.name}). ` +
      `Move the bot's role higher in Server Settings > Roles.`
    );
  }
}

/**
 * Checks if the bot possesses required Discord permissions in a guild or channel
 */
export function validateBotPermissions(
  memberOrChannelPermissions: Readonly<PermissionsBitField>,
  required: PermissionResolvable[],
  actionName: string
): void {
  const missing: string[] = [];
  for (const perm of required) {
    if (!memberOrChannelPermissions.has(perm)) {
      missing.push(typeof perm === 'string' ? perm : perm.toString());
    }
  }

  if (missing.length > 0) {
    throw new SecurityError(
      `Missing Bot Permissions for "${actionName}". The bot requires: [${missing.join(', ')}]. ` +
      `Grant these permissions to the bot role in Discord.`
    );
  }
}
