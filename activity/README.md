# Discord Activity

This directory contains the Discord Embedded App Activity used as an in-Discord control panel for the bot.

- `client/` is an isolated Vite, React, and TypeScript frontend.
- `server/` contains the Express routes, Activity OAuth/session handling, rate limiting, and Server-Sent Events transport.

The Activity is disabled by default. When `activity.enabled` is `false`, the bot does not mount Activity routes or serve the frontend.

Development commands from the repository root:

```bash
npm run activity:dev
npm run activity:build
npm run activity:test
```

The production bot serves `activity/client/dist` from `/activity`; the Vite dev server proxies `/api/activity` to the bot web server.
