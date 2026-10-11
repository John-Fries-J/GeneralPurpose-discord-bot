# Discord Activity Architecture

## Existing Business Logic

The Activity reuses these existing bot modules instead of duplicating behavior:

- Join-to-Create lifecycle: `utils/joinToCreate.js`
  - creation from trigger voice channel
  - persisted temporary voice channel records
  - empty-channel deletion
  - restart reconciliation
  - ownership transfer when the owner leaves
- Join-to-Create Discord UI: `utils/voicePanel.js` and `commands/utility/voice.js`
  - slash command and component entry points
  - owner-only operations now delegate to `services/voiceControlService.js`
- Music playback: `utils/music.js`
  - queue storage
  - track resolution
  - playback pipeline
  - voice connection setup
  - volume, pause/resume, skip, stop
- Music lifecycle: `services/musicLifecycle.js`
  - idle disconnect and voice-state cleanup
- Music Discord UI: `utils/musicButtons.js`, `utils/musicMessages.js`, and music slash commands
  - existing command/button controls now share authorization helpers from `services/musicControlService.js`
- Express dashboard/web process: `web/app.js` and `web/dashboard.js`
  - Activity routes mount only when `activity.enabled` is true
  - dashboard auth remains separate from Activity auth

## New Shared Service Layer

`services/voiceControlService.js` centralizes temporary voice control authorization and mutations:

- persisted owner check on every owner-only request
- channel rename validation
- user limit validation against guild Join-to-Create settings
- lock/unlock through Discord permission overwrites
- permit/reject/transfer/delete on the owned temporary channel only

`services/musicControlService.js` centralizes music control authorization and Activity-safe queue operations:

- users may control an active music session only from the bot playback voice channel
- `Administrator` or `Manage Server` members are treated as server-level bypass users
- track add calls `resolvePlayableTrack` and `enqueue`
- queue remove/move calls `utils/music.js`

`services/domainEvents.js` is a small scoped event bus used by existing services and the Activity realtime layer. It carries guild/channel/user scope with each event and avoids Activity-specific global state.

## Activity API

Activity routes live under `activity/server/routes.js`.

Authentication:

- Frontend initializes `@discord/embedded-app-sdk`.
- Frontend calls `discordSdk.commands.authorize`.
- Backend exchanges the returned code with Discord using the server-side client secret.
- Backend fetches `/users/@me` from Discord and creates a signed HttpOnly Activity session cookie.
- Mutations require the Activity session and an `X-Activity-Csrf` token.

Context verification:

- Browser-provided guild/channel/instance IDs are treated only as requested context.
- Backend verifies the guild is available to the bot.
- Backend fetches the authenticated Discord member from that guild.
- Channel IDs are checked against that guild when supplied.
- Voice ownership and music voice-channel membership are rechecked for every mutation.

Realtime:

- `GET /api/activity/events` uses Server-Sent Events.
- Voice and music services emit scoped domain events after successful state changes.
- The frontend refetches authoritative state when an event arrives.

## Security Boundaries

- No bot token, OAuth secret, database credentials, dashboard session secret, or Activity session secret are exposed to the frontend.
- Activity config exposed to the browser is limited to enabled status, public URL, client ID, and feature flags.
- Activity API has explicit action routes only.
- JSON request bodies are limited to 128 KB.
- Mutations are rate-limited per user, guild, and action class.
- Activity iframe paths use a Discord-compatible CSP; dashboard paths keep `X-Frame-Options: DENY`.
- State is scoped by guild and verified member identity. There is no module-level "current guild" state.

## Limitations

- Track progress is approximate and only shown when the current music queue can provide timing metadata.
- Queue reordering is button-based up/down movement, not drag-and-drop.
- Permit controls in the Activity operate on selected users from the rendered channel member list. Slash commands still support selecting another guild member through Discord's native user selector.
- Launching primarily uses Discord's App Launcher default **Launch** Entry Point command. The `/activity` command is informational.
