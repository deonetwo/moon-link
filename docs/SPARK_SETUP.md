# Connecting Moon-Link Discord MCP to Google Gemini Spark ⚡

This guide walks you through connecting your **Moon-Link Discord MCP Server** to **Google Gemini Spark** via a secure Cloudflare Tunnel.

---

## 1. Architecture Flow

When you paste an MCP URL into Google Gemini Spark, Spark performs a specific 4-step discovery handshake:

```text
1. HEAD /sse?token=<TOKEN>                      --> Reachability check (Returns 200 OK)
2. GET /.well-known/oauth-protected-resource/sse --> RFC 9470 OAuth Metadata discovery (Returns 200 OK)
3. POST /sse?token=<TOKEN> [initialize]          --> Streamable HTTP JSON-RPC initialization (Returns 200 OK)
4. POST /sse?token=<TOKEN> [tools/list]          --> Discovers all 27 Discord tools (Returns 200 OK)
```

Moon-Link is fully equipped with native handlers for all 4 steps.

---

## 2. Prerequisites & Daemons

Ensure both daemons are installed and running on your server:

```bash
# Check MCP server status (must be active and listening on port 3000)
sudo systemctl status moon-link

# Check Cloudflare Tunnel status
sudo systemctl status cloudflared
```

If not installed or stopped:
```bash
# Install and start Moon-Link systemd daemon
bash scripts/setup-systemd.sh
sudo systemctl start moon-link

# Start Cloudflare Tunnel daemon
sudo systemctl start cloudflared
```

---

## 3. Retrieve Your Active Tunnel URL

- **If using a Named Tunnel with Custom Domain**:  
  Use your configured hostname (e.g. `https://mcp.yourdomain.com`).
- **If using a Quick Tunnel (`trycloudflare.com`)**:  
  Find your ephemeral tunnel URL in the terminal or journal logs:
  ```bash
  journalctl -u cloudflared -n 30 --no-pager | grep -E "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
  ```

---

## 4. Construct Your Gemini Spark Endpoint URL

Combine your tunnel domain, the `/sse` route, and your configured `MCP_AUTH_TOKEN` (from `.env`):

```text
# Named Tunnel (Custom Domain):
https://mcp.yourdomain.com/sse?token=<YOUR_MCP_AUTH_TOKEN>

# Quick Tunnel:
https://<your-subdomain>.trycloudflare.com/sse?token=<YOUR_MCP_AUTH_TOKEN>
```

> [!NOTE]
> Replace `<YOUR_MCP_AUTH_TOKEN>` with the token defined in your server's `.env` file. Never commit real tokens or secret keys to version control.

---

## 5. Add to Gemini Spark

1. Open **Google Gemini Spark**.
2. Navigate to **Custom Tools / MCP Server Settings**.
3. Click **Add Server** or **Connect Remote MCP Server**.
4. Paste the full URL constructed in Step 4 into the URL field.
5. Click **Save / Connect**.

Spark will automatically validate the endpoint and display the list of active tools:
- `get_server_info`
- `list_channels`
- `send_message`
- `read_channel_messages`
- `list_roles`
- ...and 22 additional Discord tools.

---

## 6. Verification Prompts

Test your integration with these prompts in Gemini Spark:

### Prompt 1: Read-Only Test
> *"Get the Discord server details and summarize all channels."*

### Prompt 2: Live Message Test
> *"Send a message to `#inbox-acak` saying: 'Hello from Gemini Spark! Moon-Link is active.'"*

### Prompt 3: Audit Log Test
> *"Retrieve the latest 5 audit log entries from the server."*

---

## 7. Troubleshooting

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| `"Unable to reach origin service"` / `connect: connection refused` | Moon-Link server is stopped on port 3000. | Check status with `sudo systemctl status moon-link`. Start or restart with `sudo systemctl restart moon-link`. No machine reboot needed. |
| `"This URL does not appear to be a valid MCP server"` | Tunnel URL expired or server returned non-200. | Check `sudo journalctl -u moon-link -n 30` to inspect incoming HTTP requests. Ensure `cloudflared` is active (`sudo systemctl status cloudflared`). |
| `"The MCP server could not be reached"` | Cloudflare Tunnel is down or URL has a typo. | Verify the tunnel URL by running `curl -I <tunnel-url>/health` and checking `sudo systemctl status cloudflared`. |
| `HTTP 401 Unauthorized` | Missing or incorrect token parameter. | Ensure `?token=<YOUR_MCP_AUTH_TOKEN>` matches the token in `.env`. |
| `HTTP 429 Too Many Requests` | Rate limit exceeded (180 requests/min). | Wait 60 seconds before retrying. |
