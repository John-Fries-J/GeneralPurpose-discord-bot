# Discord Activity Setup

This bot serves the Activity at `/activity` and the Activity API at `/api/activity/*`.

## Developer Portal

1. Open the Discord Developer Portal for the bot application.
2. In **Activities > Settings**, enable Activities.
3. Add an Activity URL Mapping:
   - Prefix: `/activity`
   - Target: your HTTPS host, for example `bot.example.com`
4. Add another URL Mapping for the API if your portal setup requires separate prefixes:
   - Prefix: `/api/activity`
   - Target: the same HTTPS host.
5. In **OAuth2**, add the redirect URI required by the Embedded App SDK flow. Discord's current Activity guide notes that the SDK handles redirecting back to the Activity when `authorize` is called, but the application still needs a redirect URI configured. Use the URI Discord documents for your target client, such as `https://127.0.0.1` for local desktop testing, and add the mobile custom-scheme URI if your Activity must support mobile.
6. Enable the default Entry Point command named **Launch**. Discord creates this when Activities are enabled. That Launch command is the primary way to start the Activity from the App Launcher.

If you customize the Entry Point command manually, use Discord's current `PRIMARY_ENTRY_POINT` command type with the `DISCORD_LAUNCH_ACTIVITY` handler. This repository does not replace that command automatically.

## Bot Config

Add this to `config.json` or use the matching environment variables:

```json
"activity": {
  "enabled": true,
  "publicUrl": "https://bot.example.com/activity",
  "clientId": "",
  "voiceControls": true,
  "musicControls": true
}
```

`activity.clientId` may be omitted when top-level `clientId` is already set.

Secrets are environment-only:

```bash
DISCORD_ACTIVITY_ENABLED=true
DISCORD_ACTIVITY_PUBLIC_URL=https://bot.example.com/activity
DISCORD_ACTIVITY_CLIENT_SECRET=your-oauth-client-secret
DISCORD_ACTIVITY_SESSION_SECRET=random-long-session-secret
```

`DISCORD_ACTIVITY_CLIENT_SECRET` may reuse the same OAuth client secret used by the dashboard, but it is never sent to the browser. The frontend receives only the public client ID and feature flags.

## Local Development

Run the bot web server and the Vite Activity client:

```bash
npm run run
npm run activity:dev
```

Vite listens on `http://localhost:5173` and proxies `/api/activity` to `http://localhost:3000`.

Discord Activities require a public HTTPS endpoint for real in-client testing. Use a tunnel such as Cloudflare Tunnel or ngrok, then point the Developer Portal URL mapping at that host. Keep `DASHBOARD_PUBLIC_URL` and `DISCORD_ACTIVITY_PUBLIC_URL` aligned with the public host.

## Production Reverse Proxy

The included nginx template proxies the bot web server and disables buffering for Server-Sent Events:

```nginx
location /api/activity/events {
    proxy_pass http://bot:3000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

The production Docker image builds `activity/client/dist` and serves it from the bot process. No Vite dev server is required in production.

## Launching

Use Discord's App Launcher and select the app's **Launch** entry point. The `/activity` slash command in this bot is informational; it does not replace Discord's Activity launch mechanism.

## Troubleshooting

- Blank Activity: run `npm run activity:build` or rebuild the Docker image so `activity/client/dist` exists.
- `Activity OAuth is not configured`: set `DISCORD_ACTIVITY_CLIENT_SECRET`.
- `The Activity must be opened in a server context`: launch from a server channel, not a DM.
- `Join playback voice`: music controls require you to be in the bot's active playback voice channel unless you have the server-level bypass permissions implemented by the backend.
- No live updates: verify the reverse proxy does not buffer `/api/activity/events`.
- 403 on mutations: refresh the Activity. The backend checks ownership and voice-channel membership on every request, so stale UI state is rejected.
