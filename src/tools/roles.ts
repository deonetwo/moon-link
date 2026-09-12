import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ColorResolvable, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { formatRole, getBotMember, resolveGuild, resolveMember, resolveRole } from '../discord.js';
import { enforceConfirmation, validateBotPermissions, validateRoleHierarchy } from '../security.js';

export function registerRoleTools(server: McpServer, config: AppConfig) {
  // 1. assign_role
  server.tool(
    'assign_role',
    'Assign a Discord role to a server member',
    {
      user_id: z.string().describe('User ID of the member'),
      role_id: z.string().describe('Role ID to assign'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, role_id, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageRoles], 'assign_role');

        const role = await resolveRole(role_id, guild_id);
        const member = await resolveMember(user_id, guild_id);

        validateRoleHierarchy(botMember, role, 'assign_role');

        await member.roles.add(role, reason || 'Assigned via MCP server');
        return {
          content: [
            {
              type: 'text',
              text: `Role "${role.name}" (${role.id}) was successfully assigned to ${member.user.tag} (${member.id}).`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error assigning role: ${err.message}` }]
        };
      }
    }
  );

  // 2. remove_role
  server.tool(
    'remove_role',
    'Remove a Discord role from a server member',
    {
      user_id: z.string().describe('User ID of the member'),
      role_id: z.string().describe('Role ID to remove'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ user_id, role_id, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageRoles], 'remove_role');

        const role = await resolveRole(role_id, guild_id);
        const member = await resolveMember(user_id, guild_id);

        validateRoleHierarchy(botMember, role, 'remove_role');

        await member.roles.remove(role, reason || 'Removed via MCP server');
        return {
          content: [
            {
              type: 'text',
              text: `Role "${role.name}" (${role.id}) was successfully removed from ${member.user.tag} (${member.id}).`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error removing role: ${err.message}` }]
        };
      }
    }
  );

  // 3. create_role
  server.tool(
    'create_role',
    'Create a new role in the server',
    {
      name: z.string().min(1).max(100).describe('Name of the new role'),
      color_hex: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Must be #RRGGBB').optional().describe('Color in hex format (e.g. #3498DB)'),
      hoist: z.boolean().optional().describe('Display role members separately in member list'),
      mentionable: z.boolean().optional().describe('Allow anyone to @mention this role'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ name, color_hex, hoist, mentionable, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageRoles], 'create_role');

        const roleData: any = { name };
        if (color_hex) roleData.color = color_hex as ColorResolvable;
        if (hoist !== undefined) roleData.hoist = hoist;
        if (mentionable !== undefined) roleData.mentionable = mentionable;
        if (reason) roleData.reason = reason;

        const newRole = await guild.roles.create(roleData);
        return {
          content: [
            {
              type: 'text',
              text: `Role created successfully!\n${JSON.stringify(formatRole(newRole), null, 2)}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error creating role: ${err.message}` }]
        };
      }
    }
  );

  // 4. delete_role (Destructive - requires confirm: true)
  server.tool(
    'delete_role',
    'Delete a role from the server. Requires confirm: true.',
    {
      role_id: z.string().describe('Role ID to delete'),
      confirm: z.boolean().optional().describe('Confirmation flag. Must be true to delete role'),
      reason: z.string().optional().describe('Audit log reason'),
      guild_id: z.string().optional().describe('Discord Server ID')
    },
    async ({ role_id, confirm, reason, guild_id }) => {
      try {
        const guild = await resolveGuild(guild_id);
        const botMember = await getBotMember(guild);
        validateBotPermissions(botMember.permissions, [PermissionFlagsBits.ManageRoles], 'delete_role');

        const role = await resolveRole(role_id, guild_id);
        validateRoleHierarchy(botMember, role, 'delete_role');

        enforceConfirmation('delete_role', `role "${role.name}" (${role.id})`, confirm, config);

        const roleName = role.name;
        await role.delete(reason || 'Deleted via MCP server');

        return {
          content: [
            {
              type: 'text',
              text: `Role "${roleName}" (${role_id}) was permanently deleted.${reason ? ` Reason: ${reason}` : ''}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error deleting role: ${err.message}` }]
        };
      }
    }
  );
}
