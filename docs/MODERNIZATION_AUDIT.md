# Modernization Audit

Baseline inspected: `e401d1be2ac78713d25ad5246e46d8157c5f9f09`

Working tree note: command files already contain an uncommitted Discord command context migration. This audit reflects the current workspace contents, not only committed `HEAD`.

This audit is based on repository evidence only. The live `config.json` was not copied into this document because it may contain deployment secrets.

## P0 - Correctness, Security, Or Architectural Blockers

No confirmed P0 issue was found in the current inspection. The repository already has meaningful production safeguards:

- Dashboard OAuth state validation, bounded in-memory OAuth state storage, HMAC-signed sessions, CSRF checks, no-store/security headers, and dev/owner/Administrator dashboard authorization are implemented in `web/services/dashboardAuth.js` and `web/middleware/security.js`.
- Dashboard transcript access checks consider devs, transcript participants, server permissions, and support roles in `web/services/dashboardAuth.js`.
- Dashboard config editing redacts sensitive values and restores protected values on save through `utils/redaction.js` and `web/services/configBackups.js`.
- Normalized SQLite migrations, one-time legacy JSON/`bot_state` import, and pre-migration backups exist in `database/index.js`.
- Scheduler jobs avoid overlapping runs via `Scheduler.running` in `services/scheduler.js`.

## P1 - Major Maintainability Or Performance Modernization

- `web/dashboard.js` remains too large and mixes rendering, route registration, POST handlers, message composition, config editing, transcript responses, and app startup. It is still over 1,200 lines even after auth extraction. Representative responsibilities are visible around `renderDashboard()` in `web/dashboard.js`, route registration in `startDashboard()`, message sending in `/send-message`, and config restore/backup routes in the same file.
- Dashboard route-level business logic still lives in HTTP handlers. Examples include dashboard settings parsing/application in `web/dashboard.js`, message/template/scheduled-message logic in `/send-message`, language writes in `/language-section` and `/language-json`, and config JSON writes in `/config-json`.
- `database/repositories/*.js` domain files currently act mostly as wrappers around `database/repositories/storeRepository.js`. The real SQL implementation still lives in one broad module containing moderation, history, scheduler, voice, leveling, tickets, embeds, starboard, guild settings, import, mapping, and retention helpers.
- Migration SQL for versions 1-3 still lives inline in `database/index.js`. `database/migrations/index.js` exists, but currently only documents future staged extraction.
- SQLite is normalized, but MySQL still uses the legacy `bot_state` key/value store in `utils/store.js`. This is compatible, but it means MySQL does not receive the normalized repository architecture, query-specific reads, migrations, indexes, or per-table retention behavior.
- JSON and MySQL fallback paths in `utils/store.js` still rely on full-state reads and writes for many operations. This preserves compatibility but is inefficient for large installations and differs substantially from the SQLite path.
- Dashboard moderation rendering requests all cases for the guild via `listModerationCases(activeGuildId, {})` and then slices in memory. The repository method supports filters but not limit/offset pagination, so larger guilds can produce unnecessary synchronous SQLite work during dashboard rendering.
- Command usage records success/error but not command duration. `interactions/router.js` records `ok` and `error`, while diagnostics in `services/diagnostics.js` cannot report average or recent command latency.
- `services/diagnostics.js` exposes useful status, but metrics are not centralized for dashboard request latency, DB latency history, event-loop lag, command latency, or in-memory subsystem counts.

## P2 - Useful Improvements

- `exampleconfig.json` now uses lowercase `twitch`, and `utils/config.js` preserves legacy uppercase `Twitch` through normalization. The deprecation path exists, but user-facing docs should explicitly say uppercase `Twitch` is legacy and will be saved back as lowercase.
- Deployment secrets are environment-overridable in `utils/config.js`, but `exampleconfig.json` still contains empty secret-shaped fields such as `token`, OAuth client secret, Twitch client secret/access token, NamelessMC API key, and MySQL URL. This is compatible, but docs should steer production deployments toward environment variables.
- `events/commandHandling.js` registers guild commands only through `Routes.applicationGuildCommands(clientId, guildId)`. That is safe for server-management commands, but user-installable commands such as `/ping` and `/remindme` cannot be globally installed unless a separate global registration path is added deliberately.
- The uncommitted command modernization removes deprecated `.setDMPermission(false)` from source commands and uses `.setContexts(...)`/`.setIntegrationTypes(...)`, but there is no dedicated command JSON regression test yet.
- `utils/discordComponents.js` centralizes classic rows, buttons, selects, and modals, but there is no Components V2 abstraction for containers, sections, text displays, separators, thumbnails, or gallery/file components.
- `/help` is permission-aware and routed through `interactions/selects/index.js`, but it is still embed-based in `utils/helpSystem.js` and does not yet showcase Components V2.
- `/setup` already uses native channel and role selectors in `utils/setupWizard.js`, but it remains embed-heavy and covers a subset of configured systems: welcome, logging, tickets, temporary voice, and leveling.
- Dashboard navigation in `web/views/layout.js` is structured and responsive, but it does not yet include a dedicated Storage page with provider, schema version, WAL mode, size, row counts, and backup state.
- `Dockerfile` preserves music dependencies (`ffmpeg`, `yt-dlp`) and persistent `/app/data`, but it runs as root, lacks `NODE_ENV=production`, and has no container healthcheck.
- `.dockerignore` excludes core local files, but can be tightened to omit tests, local data backups, coverage, logs, and editor/cache artifacts from production image build contexts.
- CI in `.github/workflows/ci.yml` runs `npm run check`, `npm run lint`, and `npm test`, while `npm test` currently runs `npm run check && node --test`. This duplicates syntax checking.

## P3 - Optional Polish

- `README.md` should be updated after this modernization pass to describe the current configuration model, SQLite-first normalized storage, dashboard route architecture, command context policy, and validation workflow.
- `web/public/dashboard.css` already has design tokens, focus styles, responsive sidebar behavior, panels, badges, tables, and forms. Further UX work should be incremental and tied to page structure, not a framework rewrite.
- Message context commands are not present. User context commands already cover moderation-related workflows in `commands/context`, so any message context additions should be grounded in existing report/ticket/transcript behavior.
- `utils/language.js` still reads `language.json` synchronously at runtime. It is lower-risk than config because dashboard editing writes it intentionally, but a cached language service with invalidation would match the configuration cleanup direction.
- `commands/utility/server.js`, `commands/utility/user.js`, and moderation case views are still embed-based. These are reasonable later candidates for the Discord UI design system after `/help` and `/setup`.
