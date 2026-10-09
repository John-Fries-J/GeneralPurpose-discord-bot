# Leveling Migration Notes

## Current Behavior Before This Upgrade

- `utils/leveling.js` awarded fixed text XP per message with a single per-user text cooldown.
- Voice XP ran from the ready scheduler once per minute and counted currently connected non-bot members.
- `/rank` returned an embed and used the first 1,000 leaderboard rows to estimate placement.
- `/leaderboard` returned the top 10 records for total, text, or voice XP.
- `/levelconfig` enabled/disabled leveling and managed XP-threshold reward roles.
- Guild overrides were stored through `utils/guildConfig.js` and persisted in SQLite via `guild_settings` and `guild_level_rewards`.
- SQLite migrations are centralized in `database/index.js` plus append-only external entries in `database/migrations/index.js`.
- The dashboard already had a Leveling page, shared dashboard authentication, admin checks, and CSRF-protected settings posts.

## Compatibility Risks

- Existing guilds keep the legacy cumulative XP curve by default: `base * level * (level + 1) / 2`.
- Existing `textXpPerMessage` remains supported. When no XP range is configured, it becomes both `textXpMin` and `textXpMax`.
- Existing XP totals stay in the `levels` table; new provenance, import, role-recovery, and test records are stored beside it.
- Reward roles are still managed only when explicitly registered as leveling rewards. Role removal defaults to disabled.
- Historical message imports are estimates, not verified ProBot data. Deleted messages, inaccessible channels, unavailable threads, and historical voice activity cannot be reconstructed.
- Role recovery treats mapped roles as minimum level evidence. Multiple roles are not summed.
- Voice XP no longer awards immediately on scheduler startup for users already in voice; this prevents restart catch-up or interruption over-awards.

## Safe Recovery Flow

1. Configure role mappings with `/level role-map-add role:<role> level:<level>`.
2. Run `/level role-recovery-preview` and review the affected member count.
3. Run `/level import-preview include_roles:true` to dry-run accessible message history plus role minimums.
4. Review `/level import-status`.
5. Apply with `/level import-history apply:true include_roles:true confirm:APPLY`.
6. Use `/level test set`, `/level test xp`, and `/level test rollback` on a dedicated test account before enabling role removal.

## Required Bot Permissions

- `View Channel` and `Read Message History` for channels to scan.
- `Manage Roles` for reward-role sync, with the bot role above every managed reward role.
- `Send Messages` for level announcements and dashboard-triggered feedback where applicable.
- `Guild Members` intent is needed for full role recovery across all members.
