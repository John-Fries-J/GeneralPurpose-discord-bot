# Modernization Audit

Baseline inspected: `a929e352fef8f1f54b75d35b2afc4745e0d5650c`

This audit is based on the repository state, not inferred wishlist items. The live `config.json` was not value-dumped because it may contain deployment secrets; configuration findings are based on `exampleconfig.json`, validators, env override code, redaction code, and consumers.

## P0 - Correctness, Security, Or Architectural Blockers

No confirmed P0 issue was found during the read-only audit. The repository already has important production safeguards:

- Dashboard OAuth state validation, HMAC-signed session cookies, CSRF checks, no-store security headers, and owner/dev/Administrator authorization in `web/dashboard.js`.
- Recursive dashboard/config redaction in `utils/redaction.js` with security regression coverage in `test/securityPhaseA.test.js` and `test/securityPhaseB.test.js`.
- Normalized SQLite migrations and one-time legacy JSON/`bot_state` import in `database/index.js`.
- Scheduler overlap protection via `Scheduler.running` in `services/scheduler.js`.

## P1 - Major Maintainability Or Performance Modernization

- `web/dashboard.js` is too large and mixes unrelated concerns. It is 1,588 lines and contains cookie parsing, OAuth state storage, session signing, auth middleware, CSRF middleware, dashboard authorization, health routes, OAuth routes, transcript authorization, rendering, command/config POST handlers, backup routes, language editing, message sending, and app startup. See `web/dashboard.js:67`, `web/dashboard.js:98`, `web/dashboard.js:122`, `web/dashboard.js:163`, `web/dashboard.js:170`, `web/dashboard.js:203`, `web/dashboard.js:838`, and `web/dashboard.js:1164`.
- The repository abstraction is a single broad module. `database/repositories/storeRepository.js` contains schema mapping, moderation, history, command usage, voice, starboard, leveling, scheduled messages, embed templates, tickets, reminders, scheduler status, guild settings, config audit, and legacy import functions. See `database/repositories/storeRepository.js:183`, `database/repositories/storeRepository.js:261`, `database/repositories/storeRepository.js:303`, `database/repositories/storeRepository.js:349`, `database/repositories/storeRepository.js:415`, `database/repositories/storeRepository.js:458`, `database/repositories/storeRepository.js:576`, and `database/repositories/storeRepository.js:755`.
- Migration SQL is embedded directly in `database/index.js`; future schema work will keep growing the database bootstrap file. Current migrations are applied through inline SQL at `database/index.js:70`, `database/index.js:343`, and `database/index.js:392`.
- Runtime configuration reads synchronously parse JSON repeatedly. `utils/config.js:getConfig()` reads `config.json`/`exampleconfig.json` on every call, and hot-path consumers call it in events, commands, dashboard routes, diagnostics, storage, features, permissions, and services. See `utils/config.js:9`, `utils/config.js:12`, and consumers reported by `rg getConfig`.
- `saveConfig()` writes directly to `config.json` without an atomic temp-file rename. A process interruption during a dashboard/config write can leave a partial file. See `utils/config.js:59`.
- Application command builders still use deprecated `.setDMPermission(false)` broadly across config, moderation, ticket, context, and several utility commands. Examples: `commands/moderation/ban.js:10`, `commands/config/setup.js:9`, `commands/ticket/ticketembed.js:20`, `commands/context/viewhistory.js:9`, and `commands/utility/server.js:21`.
- Dashboard render-time data loading can query more data than the page needs. `renderDashboard()` conditionally loads data, which is good, but some page paths still load entire unpaginated domain sets such as all moderation cases for a guild and then slice in memory. See `web/dashboard.js:838` through `web/dashboard.js:886` and `database/repositories/storeRepository.js:278`.
- Append-only tables have hard-coded retention trims in write paths instead of centralized configurable retention policy. Examples: `user_history` keeps the latest `history.maxEntries`, but globally across all guilds, in `database/repositories/storeRepository.js:303`; `command_usage` is capped at 10,000 in `database/repositories/storeRepository.js:349`; `voice_activity` is capped at 5,000 in `database/repositories/storeRepository.js:415`; `guild_config_audit` is not retained for SQLite.
- Several IDs are generated with `Date.now()` plus `Math.random()` instead of `crypto.randomUUID()`. Confirmed in `database/repositories/storeRepository.js:18`, `utils/store.js:394`, `utils/store.js:680`, `utils/store.js:709`, `utils/store.js:862`, `utils/store.js:966`, and `utils/store.js:1137`.

## P2 - Useful Improvements

- `exampleconfig.json` still includes legacy uppercase `Twitch` beside lowercase `twitch`. Lowercase `twitch` is consumed by `commands/config/twitch.js`, `utils/mediaAnnouncements.js`, and dashboard config editing, while uppercase `Twitch` appears to be legacy example configuration. See `exampleconfig.json` near the final `Twitch` object and lowercase `twitch` section.
- `exampleconfig.json` includes `database.mongo`, but validation only permits `sqlite`, `json`, or `mysql`, and the storage layer only implements JSON, SQLite, and MySQL. See `exampleconfig.json` `database.mongo`, `utils/configValidation.js` database provider validation, and `utils/store.js:getStorageSettings()`.
- CI runs `npm run check` and then `npm test`, while `npm test` itself runs `npm run check && node --test`. This repeats syntax checking. See `package.json` scripts and `.github/workflows/ci.yml`.
- Docker runtime is root by default and lacks a healthcheck. The Dockerfile uses `node:22-alpine`, installs production deps, exposes `/app/data`, and preserves ffmpeg/yt-dlp, but does not set `NODE_ENV=production`, use a non-root user, or define a healthcheck. See `Dockerfile`.
- The dashboard navigation is already structured, but it does not match the proposed information architecture exactly. Current groups are Overview, Server, Community, Moderation, Voice, Integrations, and System in `web/views/layout.js`.
- The dashboard has good CSS primitives, focus styles, responsive navigation, and dirty-form UX in `web/public/dashboard.css` and `web/public/dashboard.js`, but rendering is still string-heavy and centralized in `web/dashboard.js`.
- Public health endpoints are minimal, while diagnostics expose richer internal state with secret redaction. Metrics are useful but not yet centralized as counters/histograms for command latency, dashboard request latency, DB latency, event-loop lag, or scheduler duration beyond persisted last duration. See `services/diagnostics.js` and `services/scheduler.js`.
- Command usage records successes/errors but not duration. `interactions/router.js` records `ok` and `error` after execution; latency would support dashboard diagnostics and performance tracking.
- `/help` is embed-based with a single category select. It is permission-aware through `memberCanUseCommand()` and `isCommandEnabled()`, but it does not yet showcase Components V2. See `utils/helpSystem.js`.
- `/setup` already uses channel/role selects and short-lived drafts, which is a strong foundation. It remains embed-heavy and covers welcome, logging, tickets, temporary voice, and leveling, but not all configured systems listed in `exampleconfig.json`. See `utils/setupWizard.js`.

## P3 - Optional Polish

- `README.md` should be updated after modernization batches to describe the normalized database architecture, dashboard modules, env-first secrets, and validation workflow.
- A Storage dashboard page would be useful. Current health shows provider/latency, but there is no dedicated safe storage page with schema version, SQLite WAL status, DB size, table counts, backup state, or maintenance status.
- Context menu commands currently cover useful user context actions (`Moderate User`, `Add Moderator Note`, `View History`, `User Information`) and reuse moderation/history services. Message context commands are absent; adding them should be driven by existing ticket/report workflows rather than duplication.
- `.dockerignore` is minimal. It excludes `node_modules`, logs, VCS/editor folders, `config.json`, and `.env`, but could also exclude test artifacts and local data backups if those become noisy.
