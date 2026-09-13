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

Ensure both daemons are running on your server:

```bash
# Check MCP server status
sudo systemctl status moon-link

# Check Cloudflare Tunnel status
sudo systemctl status cloudflared-quick
```

If either is stopped:
```bash
sudo systemctl start moon-link
sudo systemctl start cloudflared-quick
```

---

## 3. Retrieve Your Active Tunnel URL

Find your public tunnel domain from the `cloudflared-quick` journal logs:

```bash
sudo journalctl -u cloudflared-quick -n 30 --no-pager | grep -E "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
```

You will see output similar to:
```text
https://delayed-deutsche-optical-roger.trycloudflare.com
```

---

## 4. Construct Your Gemini Spark Endpoint URL

Combine your tunnel domain, the `/sse` route, and your configured `MCP_AUTH_TOKEN` (from `.env`):

```text
https://<your-subdomain>.trycloudflare.com/sse?token=<MCP_AUTH_TOKEN>
```

**Example:**
```text
https://delayed-deutsche-optical-roger.trycloudflare.com/sse?token=c3fecb11e199fb5ee48694b99c2e2dbafc906d6eb366e27e0c605e68816f82a3
```

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
| `"This URL does not appear to be a valid MCP server"` | Tunnel URL expired or server returned non-200. | Check `sudo journalctl -u moon-link -n 30` to inspect incoming HTTP requests. Ensure `cloudflared-quick` is running. |
| `"The MCP server could not be reached"` | Cloudflare Tunnel is down or URL has a typo. | Verify the tunnel URL by running `curl -I <tunnel-url>/health`. |
| `HTTP 401 Unauthorized` | Missing or incorrect token parameter. | Ensure `?token=<MCP_AUTH_TOKEN>` matches the token in `.env`. |
| `HTTP 429 Too Many Requests` | Rate limit exceeded (180 requests/min). | Wait 60 seconds before retrying. |
