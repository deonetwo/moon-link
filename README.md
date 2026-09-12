# Moon-Link Discord MCP Server 🌕🔗

A secure, enterprise-ready **Model Context Protocol (MCP)** server built with TypeScript, Node.js, and Discord.js v14. Designed specifically to manage private Discord servers from AI agents (Claude Desktop, Antigravity, Cursor, etc.) running locally or remotely on an AWS server.

---

## 🔒 Security Architecture & Guardrails

Managing a private Discord server via AI requires stringent security safeguards:

1. **Strict Server Whitelisting (`ALLOWED_GUILD_IDS`)**:
   - The bot will **only** operate on the server IDs explicitly configured.
   - Any attempt to target or inspect servers outside the whitelist fails immediately with an `Access Denied` security error.
2. **Destructive Action Double-Confirmation**:
   - High-impact, irreversible actions (`delete_channel`, `kick_member`, `ban_member`, `delete_role`, `purge_messages`) require passing `confirm: true`.
   - If omitted, the tool safely aborts and displays a warning with the target preview.
3. **Role Hierarchy Enforcement**:
   - The server enforces Discord's role hierarchy prior to executing moderation or role mutations.
   - Protects server owners and prevents the bot from altering members or roles equal to or higher than its own highest role.
4. **Snowflake ID Validation**:
   - All Channel, User, Guild, Role, and Message IDs are strictly validated with `^\d{17,20}$` before sending to the Discord API.
5. **Token Redaction & Safe Stdio**:
   - Sensitive tokens are masked in logs and diagnostics.
   - In `stdio` mode, `console.log` is redirected to `console.error` (stderr) to prevent JSON-RPC transport corruption.
6. **Authenticated SSE Transport for AWS**:
   - When exposed over HTTP/SSE on AWS, requests are protected with Bearer token authentication (`MCP_AUTH_TOKEN`).

---

## 📋 Available MCP Tools & Resources

### 🏰 Server & Member Inspection
- `get_server_info`: View comprehensive server metrics (channels, roles, members, boost level, owner).
- `list_channels`: List channels grouped by category, type (text, voice, category, forum), topic, and position.
- `list_roles`: List all roles ordered by position hierarchy with permissions and member counts.
- `list_members`: Search or paginate members by name/nickname or filter by role.
- `get_member`: Retrieve a member's profile, roles, permissions, account age, and moderation state.

### 💬 Messaging & Channels
- `send_message`: Send messages with rich formatting, embeds (title, description, color, fields), and replies.
- `read_channel_messages`: Fetch recent channel history (up to 100 messages) with author, timestamp, attachments, and reactions.
- `delete_message`: Delete a specific message by ID.
- `purge_messages`: Bulk delete messages younger than 14 days (*Safety confirmed*).
- `add_reaction`: Add emoji reactions (Unicode or custom) to messages.
- `create_thread`: Create threads in text channels or from existing messages.

### 🛠️ Channel Administration
- `create_channel`: Create text, voice, announcement, or category channels with topic, slowmode, and NSFW settings.
- `modify_channel`: Edit channel name, topic, slowmode rate limit, category, and NSFW status.
- `delete_channel`: Permanently delete a channel (*Safety confirmed*).

### 👥 Role Management
- `assign_role`: Assign a role to a member (*Hierarchy checked*).
- `remove_role`: Remove a role from a member (*Hierarchy checked*).
- `create_role`: Create roles with custom names, colors, and permissions.
- `delete_role`: Delete a role (*Hierarchy checked, Safety confirmed*).

### 🛡️ Moderation & Safety
- `timeout_member`: Apply temporary communication timeouts/mutes (1 to 40,320 minutes) with reason.
- `remove_timeout`: Remove timeouts from members.
- `kick_member`: Kick a member with audit log reason (*Hierarchy checked, Safety confirmed*).
- `ban_member`: Ban a member or user ID with optional message history deletion (*Hierarchy checked, Safety confirmed*).
- `unban_member`: Unban a user by ID.
- `list_bans`: List banned users and reasons.

### 📜 Invites & Audit Logs
- `create_invite`: Create channel invite links with expiration and usage limits.
- `list_invites`: List active server invites.
- `get_audit_logs`: View recent moderation and administrative action logs.

### 📦 MCP Resources
- `discord://server/overview`: Real-time JSON overview of the Discord server.
- `discord://channels/list`: Complete channels list resource.
- `discord://roles/list`: Complete roles list resource.

---

## 🚀 Setup Guide

### 1. Create Discord Bot Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Go to the **Bot** tab on the left:
   - Click **Reset Token** and copy your **Bot Token**.
   - Under **Privileged Gateway Intents**, enable:
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Click **Save Changes**.
3. Go to **OAuth2 > URL Generator**:
   - Scopes: check `bot` and `applications.commands`.
   - Bot Permissions: check `Administrator` (or select specific permissions: Manage Channels, Manage Roles, Kick Members, Ban Members, Moderate Members, Send Messages, Read Message History, View Audit Log).
   - Copy the generated URL into your browser to invite the bot to your private Discord server.

### 2. Configure `.env`
In this server directory (`/home/ubuntu/moon-link`):
```bash
cp .env.example .env
nano .env
```
Fill in:
```ini
DISCORD_BOT_TOKEN=your_actual_bot_token_here
DISCORD_GUILD_ID=your_private_server_id_here
ALLOWED_GUILD_IDS=your_private_server_id_here
MCP_TRANSPORT=stdio
REQUIRE_CONFIRMATION=true
```

> **Tip**: To get your Server ID, enable **Developer Mode** in Discord (`User Settings > Advanced > Developer Mode`), right-click your server icon in the left server list, and click **Copy Server ID**.

### 3. Run the Diagnostic Test
Verify your credentials and permissions before launching:
```bash
npm run test:connection
```
The test verifies:
- Bot authentication
- Access to your private guild
- Permissions checklist (Manage Channels, Roles, Ban, Kick, etc.)
- Bot role hierarchy position

---

## 🖥️ Running the MCP Server

### Mode A: Stdio Transport (Local CLI, Claude Desktop, or SSH)
Build and run directly:
```bash
npm run build
npm start
# or during development:
npm run dev
```

#### Connecting via Claude Desktop (over SSH to this AWS server):
Add to your local `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "discord-server": {
      "command": "ssh",
      "args": [
        "-i", "/path/to/your/aws-key.pem",
        "ubuntu@<YOUR_AWS_PUBLIC_IP>",
        "node /home/ubuntu/moon-link/dist/index.js"
      ]
    }
  }
}
```

---

### Mode B: HTTP / SSE Transport (Remote MCP Clients)
Set in `.env`:
```ini
MCP_TRANSPORT=sse
MCP_PORT=3000
MCP_HOST=0.0.0.0
MCP_AUTH_TOKEN=super_secret_token_here
```
Run:
```bash
npm start
```
Clients connect to:
- **SSE URL**: `http://<YOUR_AWS_IP>:3000/sse`
- **Header**: `Authorization: Bearer super_secret_token_here`
- **Health check**: `http://<YOUR_AWS_IP>:3000/health`

---

## ⚙️ Running as a 24/7 Background Daemon on AWS

To keep the MCP server running 24/7 and automatically restart on reboot or crash:
```bash
./scripts/setup-systemd.sh
```
Management commands:
```bash
sudo systemctl start moon-link       # Start
sudo systemctl stop moon-link        # Stop
sudo systemctl restart moon-link     # Restart
sudo systemctl status moon-link      # Status
journalctl -u moon-link -f          # Live logs
```

---

## 🧪 Testing

Run the automated security and architecture test suite:
```bash
npm test
```
Verifies Snowflake validation, guild whitelist enforcement, destructive action confirmation, and hierarchy safety guardrails.
