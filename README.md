# GeneralPurpose Discord Bot

A Discord.js v14 bot with common moderation, ticket, suggestion, welcome, logging, Twitch notification, utility commands, and an optional simple web dashboard.

This project is meant to be easy to run and easy to edit. Runtime IDs and secrets live in `config.json` by default; production Docker deployments can set `CONFIG_PATH` to use a mounted data directory instead. Public-facing text lives in `language.json`.

## Support

For support questions, join the Discord: https://discord.gg/dCCksYzPWU

## Requirements

- Node.js 22.12 or newer
- A Discord bot token
- Server member, message content, and moderation intents enabled in the Discord Developer Portal
- Bot permissions for moderation features: manage roles, manage channels, ban members, moderate members, and create invites
- Optional for the dashboard: Discord OAuth2 client ID, client secret, and redirect URL

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy the example config:

```bash
cp exampleconfig.json config.json
```

On Windows PowerShell:

```powershell
Copy-Item exampleconfig.json config.json
```

3. Fill in `config.json`:

- `token`: Discord bot token
- `clientId`: Discord application/client ID
- `guildId`: server ID used for slash command registration
- `statusName`: bot status text
- `welcomeID`: channel ID for join welcome messages
- `suggestionID`: channel ID for suggestions
- `logChannels`: channel IDs for general, moderation, ticket, suggestion, direct message, message, and thread logs
- `roles.autoRoleId` or `roles.autoRoleIds`: role IDs given to new members
- `dashboard`: optional web panel settings; leave `enabled` as `false` to disable it
- `database`: optional state storage settings; SQLite is the default
- `commandSettings`: module and command enable/disable settings, usually edited by the dashboard
- `moderation.muteRoleId`: saved automatically the first time `/mute` creates the mute role
- `tickets`: global ticket defaults; `/ticket setup`, `/setup`, and the dashboard save server-specific overrides
- `twitch`: optional Twitch notification settings

4. Edit bot wording in `language.json`.

5. Run the bot:

```bash
npm run run
```

The bot validates the active config file on startup and the dashboard validates config edits before saving. If a value has the wrong shape, the error lists the exact field to fix.

## Docker

Build the image:

```bash
docker build -t generalpurpose-discord-bot .
```

Run with a mounted data directory and config:

```bash
mkdir -p data
cp exampleconfig.json data/config.json
docker run --rm -it \
  -v "${PWD}/data:/app/data" \
  -e CONFIG_PATH="/app/data/config.json" \
  generalpurpose-discord-bot
```

You can also provide the core Discord values with environment variables:

```bash
docker run --rm -it \
  -v "${PWD}/data:/app/data" \
  -e CONFIG_PATH="/app/data/config.json" \
  -e DISCORD_TOKEN="your-token" \
  -e DISCORD_CLIENT_ID="your-client-id" \
  -e DISCORD_GUILD_ID="your-server-id" \
  generalpurpose-discord-bot
```

Do not bind-mount `/app/config.json` as a single writable file in production. The bot saves configuration atomically by writing a temporary file and renaming it over the configured path. Mount a writable directory such as `/app/data` and set `CONFIG_PATH=/app/data/config.json` so the rename stays inside the mounted directory. If `CONFIG_PATH` points at a missing file, the bot initializes it from `exampleconfig.json`; it will not overwrite an existing file.

For the dashboard and longer temporary punishments, also mount `data/` and publish the dashboard port:

```bash
docker run --rm -it \
  -p 3000:3000 \
  -v "${PWD}/data:/app/data" \
  -e CONFIG_PATH="/app/data/config.json" \
  -e DASHBOARD_ENABLED="true" \
  -e DISCORD_OAUTH_CLIENT_ID="your-oauth-client-id" \
  -e DISCORD_OAUTH_CLIENT_SECRET="your-oauth-client-secret" \
  -e DISCORD_OAUTH_REDIRECT_URI="http://localhost:3000/auth/discord/callback" \
  generalpurpose-discord-bot
```

### Dashboard With A Domain

The included `docker-compose.dashboard.yml` runs only the bot and binds the dashboard to `127.0.0.1:3000`, which is suitable when you already have nginx, Caddy, Traefik, Cloudflare Tunnel, or another reverse proxy on the host.

1. Create the production config under the persistent data mount:

```bash
mkdir -p data
cp exampleconfig.json data/config.json
```

2. Create a deployment env file:

```bash
cp deploy/dashboard.env.example .env
```

3. Edit `.env` and set:

```bash
DASHBOARD_DOMAIN=dashboard.example.com
CONFIG_PATH=/app/data/config.json
```

4. In the Discord Developer Portal, add this OAuth redirect URL:

```text
https://dashboard.example.com/auth/discord/callback
```

5. Start the dashboard container:

```bash
docker compose -f docker-compose.dashboard.yml --env-file .env up -d --build
```

6. Configure your existing reverse proxy to forward `https://dashboard.example.com` to `http://127.0.0.1:3000`.

A production Compose service can be as small as:

```yaml
services:
  bot:
    image: generalpurpose-discord-bot
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./data:/app/data
      - ./language.json:/app/language.json
    environment:
      CONFIG_PATH: /app/data/config.json
      DASHBOARD_ENABLED: "true"
      DASHBOARD_HOST: "0.0.0.0"
      DASHBOARD_PORT: "3000"
      DASHBOARD_PUBLIC_URL: "https://dashboard.example.com"
      DISCORD_OAUTH_REDIRECT_URI: "https://dashboard.example.com/auth/discord/callback"
```

## Web Dashboard

The dashboard is disabled by default.

![Dashboard preview](https://i.johnfries.net/images/342Wise.png)

1. In the Discord Developer Portal, open your application and go to **OAuth2**.
2. Add this redirect URL: `http://localhost:3000/auth/discord/callback`.
3. Put the same URL in `dashboard.oauth.redirectUri`.
4. Set `dashboard.enabled` to `true`.
5. Set `dashboard.oauth.clientId` and `dashboard.oauth.clientSecret`, or use the environment variables shown above.
6. Start the bot and open `http://localhost:3000`.

Dashboard access requires Discord OAuth. Full dashboard administration is limited to users listed in `devs`, the configured guild owner, or members with `Administrator` in the configured `guildId`; `Manage Server` alone does not grant unrestricted dashboard access. The panel is split into focused pages for overview, modules, commands, community settings, tickets, temporary voice, leveling, music, language, message sending, config, backups, health, audit, and logs. It can edit structured per-guild settings, edit advanced config sections, toggle modules and commands, set per-command user/role access rules, edit `language.json` response text, send or schedule messages through the bot, manage embed templates, create redacted config backups, restore validated backups, and view recent bot/dashboard logs. Disabled commands are blocked immediately; restart the bot to refresh Discord's visible slash command list.

The dashboard includes a light/dark theme toggle stored in the browser. Login sessions use signed cookies that last 30 days, so users do not need to re-authorize after every dashboard restart. Set `DASHBOARD_SESSION_SECRET` if you want a dedicated signing secret instead of using the configured dashboard OAuth secret or bot token.

The dashboard language editor cannot change the embed footer watermark. The watermark is locked by code in `utils/language.js`, so changing it requires a code edit rather than a dashboard save.

The dashboard exposes unauthenticated `GET /health` and `GET /ready` for deployment probes. They return only minimal readiness booleans and uptime. Detailed health information is available on the authenticated dashboard health page.

Useful dashboard environment variables:

- `CONFIG_PATH=/app/data/config.json`
- `DASHBOARD_ENABLED=true`
- `DASHBOARD_PORT=3000`
- `DASHBOARD_PUBLIC_URL=http://localhost:3000`
- `DASHBOARD_SESSION_SECRET=...`
- `DISCORD_OAUTH_CLIENT_ID=...`
- `DISCORD_OAUTH_CLIENT_SECRET=...`
- `DISCORD_OAUTH_REDIRECT_URI=http://localhost:3000/auth/discord/callback`

## Database / State Storage

No external database is required. The bot uses a normalized SQLite database at `data/bot.sqlite` by default, powered by `better-sqlite3`. SQLite runs with foreign keys and WAL enabled, so production backups should include `bot.sqlite` plus any `bot.sqlite-wal` and `bot.sqlite-shm` sidecar files. Runtime state such as temporary punishments, reminders, scheduled dashboard messages, ticket metadata/transcripts, temporary voice metadata, per-guild settings, config audit entries, command usage, and user history is restart-persistent where the feature records it.

Existing `bot_state` SQLite files and `data/bot-state.json` files are imported into the normalized schema once on startup. The old file is copied to a `.pre-normalized.<timestamp>.bak` backup first and is not deleted automatically.

Existing small installs can still use JSON storage by setting `database.provider` to `json`; the JSON file lives at `data/bot-state.json`. MySQL is supported by setting `database.provider` to `mysql` and putting a MySQL connection string in `database.mysql.url`. Startup logs show the active provider and migration summary, with credentials redacted. Dashboard config backups redact deployment secrets; restore only accepts listed backup files, validates JSON/config shape before saving, rejects dangerous prototype keys, and preserves protected deployment values such as tokens and database connection settings.

## Commands

Moderation:

- `/ban user reason duration` bans a user, with an optional temporary duration.
- `/softban user reason delete_days` DMs an autogenerated invite, bans to delete messages, then unbans the user.
- `/kick user reason` kicks a user from the server.
- `/warn user reason` warns a user and logs it.
- `/case id` shows a moderation case.
- `/cases user` lists recent moderation cases for a user.
- `/history user` shows recent database-backed user history.
- `/reason case_id reason` updates a moderation case reason.
- `/clearwarns user reason` clears active warning cases for a user.
- `/unban user_id` unbans a user by Discord ID.
- `/mute user duration reason` applies the mute role, removes normal roles, and restores them after the duration.
- `/unmute user` removes the mute role and restores stored roles.
- `/purge amount` deletes 1 to 100 recent messages.
- `/slowmode channel seconds reason` sets channel slowmode.
- `/lock channel reason` locks a channel for everyone.
- `/unlock channel reason` unlocks a channel.
- `/nick user nickname reason` changes or clears a nickname.
- `/role add user role reason` adds a role.
- `/role remove user role reason` removes a role.

Utility:

- `/ping` shows bot websocket ping.
- `/user user` shows user information.
- `/userinfo id` looks up a user by Discord ID.
- `/server` shows server information.
- `/serverstats` shows server stats.
- `/avatar user user` shows a user's avatar.
- `/avatar server` shows the server icon.
- `/member role` lists members with a role.
- `/welcome user` sends the configured welcome embed.
- `/help command` lists commands or shows details for one command.
- `/poll question option1 option2 ...` creates a native Discord poll.
- `/announce channel message` sends an announcement embed.
- `/remindme duration message` sends you a DM reminder.

Tickets:

- `/ticket setup channel role category` posts the ticket panel and saves server-specific ticket settings.
- `/ticket add user` adds a user to the current ticket.
- `/ticket remove user` removes a user from the current ticket.
- `/ticket rename name` renames the current ticket.
- `/ticket transcript` saves a dashboard transcript link with Discord-style HTML rendering. Viewers must sign in to the dashboard and be involved in the ticket or have staff/dashboard access.
- `/close` closes the current ticket channel.
- `/delete` deletes a closed ticket channel.

Suggestions:

- `/suggest suggestion` sends a suggestion, adds vote reactions, and starts a thread.
- `/suggestion approve message_id reason` approves a suggestion.
- `/suggestion deny message_id reason` denies a suggestion.

Config:

- `/config view` shows a safe config summary.
- `/config set-log-channel type channel` updates a log channel.
- `/setup` opens an interactive setup wizard for server-specific welcome, logging, ticket, temporary voice, and leveling settings.
- `/autorole set role` sets the join autorole.
- `/autorole clear` clears join autoroles.
- `/honeypot configure channel alert_channel ping` enables the scam honeypot and optionally pings a user or role on alerts.
- `/honeypot disable` disables the honeypot.
- `/honeypot view` shows honeypot settings.
- `/counter add type channel role name_format` adds or replaces a member counter voice channel. Role counters require `role`.
- `/counter remove channel` removes a counter.
- `/counter list` lists counters.
- `/counter refresh` refreshes counters immediately.
- `/youtube set-api-key api_key` enables YouTube API classification.
- `/youtube add channel_id text_channel name video_message short_message stream_message community_message` adds YouTube announcements.
- `/youtube remove channel_id text_channel` removes YouTube announcements.
- `/twitch set-credentials client_id client_secret access_token` saves Twitch API credentials. `client_secret` enables automatic app-token refresh.
- `/twitch add streamer_id streamer_name text_channel message` adds Twitch announcements.
- `/twitch remove streamer_id text_channel` removes Twitch announcements.
- `/jointocreate setup trigger_channel category name_format max_limit` enables join-to-create.
- `/jointocreate disable` disables join-to-create.
- `/voice limit amount`, `/voice name name`, `/voice lock`, `/voice unlock`, `/voice permit user`, and `/voice reject user` manage owned temporary voice channels.
- `/levelconfig enable mode text_xp min_xp max_xp voice_xp cooldown` enables leveling.
- `/levelconfig profile profile formula base factor confirm` previews or applies an XP curve change. Re-run with `confirm: APPLY` after reviewing the level thresholds.
- `/levelconfig add-role xp role` adds an XP role reward.
- `/levelconfig add-level-role level role` adds a level-based role reward.
- `/levelconfig remove-role role` removes a reward.
- `/levelconfig role-sync` configures automatic reward-role granting/removal. Obsolete role removal is disabled unless explicitly enabled.
- `/level import-preview` dry-runs historical XP reconstruction from accessible Discord message history.
- `/level import-history apply:true confirm:APPLY` applies a historical XP import through a background job.
- `/level import-status` and `/level import-cancel` monitor or cancel import jobs.
- `/level role-map-add role level`, `/level role-map-view`, and `/level role-recovery-preview` recover minimum levels from existing reward roles.
- `/level test set`, `/level test xp`, `/level test preview`, `/level test sync-roles`, `/level test reset`, and `/level test rollback` smoke-test leveling changes with persistent rollback sessions.
- `/leaderboard type page` shows paginated total, text, or voice XP leaders.

Music:

- `/play query` accepts a direct URL or search text. `/play audio` accepts an uploaded audio file. The legacy `/music play` and `/music file` commands remain available for compatibility. Spotify track links are converted to a searchable track name; full Spotify audio is not streamed directly.
- `/queue`, `/skip`, `/stop`, and `/volume amount` manage playback.
- YouTube may require browser cookies on hosted servers. Export YouTube cookies in Netscape format to `data/youtube-cookies.txt`, or set `music.ytDlpCookiesPath` / `YTDLP_COOKIES_PATH` to another mounted path. Rebuild the Docker image after music dependency changes.

Honeypot:

- Messages in the configured honeypot channel are deleted with up to 15 recent messages from the same user across accessible server text channels, with a delayed second cleanup pass.
- A scam alert embed is sent to the alert channel with Limit User, Soft Ban, Time Out, and Ignore buttons.
- Automatic and staff-triggered honeypot actions use the reason `Scam`, check Discord hierarchy and bot permissions, and update the alert embed after success or failure.

Member Counters:

- Counter voice channels can show total members, bots, boosters, or members with a specific role.
- Use `{count}` in `name_format`, such as `Members: {count}`. Role counters also support `{roleName}`.

Media Announcements:

- YouTube and Twitch support multiple source channels and different Discord destination channels.
- YouTube messages can be configured separately for videos, shorts, live streams, and best-effort community posts. If the YouTube API key is missing, invalid, or quota-limited, the bot falls back to RSS; RSS does not include community posts.
- Twitch live messages support `{streamer}`, `{title}`, `{game}`, and `{url}`. When `clientSecret` is configured, Twitch app access tokens refresh automatically.

Join-to-Create:

- Users join the configured trigger voice channel and the bot creates a temporary channel for them.
- Empty temporary channels are deleted automatically, active temporary channel metadata is reconciled on startup, and disabling join-to-create deletes active temporary channels.
- Owners can set a limit within the configured maximum, rename, lock, unlock, permit users, and reject users.

Leveling:

- Text XP supports configurable min/max XP per eligible message, cooldowns, multipliers, exclusions, optional anti-farm checks, and legacy-compatible fixed XP.
- XP curves support the legacy formula, linear, quadratic, exponential, and a ProBot-inspired estimate. The ProBot-inspired profile is not ProBot's private formula.
- Voice XP is awarded once per minute to eligible non-bot users and can exclude AFK, deafened, or solo users. XP is not backfilled after restarts.
- Rewards are based on total XP or configured levels and can grant roles automatically. Obsolete reward-role removal defaults to off and only touches registered leveling rewards.
- Historical imports scan only channels and threads the bot can access with Discord's API. Deleted messages, unavailable history, and historical voice XP are not counted or fabricated.
- Existing reward roles can be mapped to minimum levels. If a member has Level 5, 10, and 20 roles, recovery infers level 20, not level 35.
- Rank cards include avatar, level, XP, progress, server rank, and text/voice breakdown, with an embed fallback.
- More migration detail is in `docs/LEVELING_MIGRATION.md`.

## Editing Text

Use `language.json` for text users see in embeds, replies, ticket buttons, and welcome messages.

## Checks

Run a syntax check before committing:

```bash
npm test
```

## Author

**John Fries** - [John-Fries-J](https://github.com/John-Fries-J/)
