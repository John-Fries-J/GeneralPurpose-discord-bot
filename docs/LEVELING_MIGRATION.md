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
- Historical message imports are estimates, not verified ProBot data. Deleted messages, inaccessible channels, unavailable threads, skipped or failed channel scans, and historical voice activity cannot be reconstructed.
- Role recovery treats mapped roles as minimum level evidence. Multiple roles are not summed.
- Voice XP no longer awards immediately on scheduler startup for users already in voice; this prevents restart catch-up or interruption over-awards.

## Safe Recovery Flow

1. Configure role mappings with `/level role-map-add role:<role> level:<level>`.
2. Run `/level role-recovery-preview` and review the affected member count.
3. Run `/level import-preview include_roles:true` to dry-run accessible message history plus role minimums.
4. Review `/level import-status`.
5. Apply with `/level import-history apply:true include_roles:true confirm:APPLY`. If the dry run reported skipped channels, failed scans, or incomplete member fetching and you still accept the partial import, use `confirm:APPLY_INCOMPLETE`; apply jobs stop before changing XP when incomplete data is detected without that stronger confirmation.
6. Use `/level test set`, `/level test xp`, and `/level test rollback` on a dedicated test account before enabling role removal.

## Historical Calibration Preview

- Use `/level calibration-preview job_id:<completed-job-id> profile:ProBot-inspired default` to replay stored historical import messages under a different XP profile without rescanning Discord and without changing XP or roles.
- Use `/level calibration-preview job_id:<completed-job-id> profile:Custom options min_xp:<n> max_xp:<n> cooldown:<seconds> formula:<formula>` to test specific XP settings.
- Use `/level calibration-fit job_id:<completed-job-id>` after configuring reward-role mappings to compare plausible profiles against role-derived minimum-level evidence. The command reports reconstructed levels from messages and protected levels that preserve confirmed role milestones.
- Add `export:CSV` or `export:JSON` to calibration commands when detailed per-user preview output is needed.
- Calibration is read-only: it streams `level_import_messages`, recalculates hypothetical XP from stored message IDs and timestamps, and does not write reconciliation records, processed-message rows, live XP balances, config, or Discord roles.

## Required Bot Permissions

- `View Channel` and `Read Message History` for channels to scan.
- `Manage Roles` for reward-role sync, with the bot role above every managed reward role.
- `Send Messages` for level announcements and dashboard-triggered feedback where applicable.
- `Guild Members` intent is needed for full role recovery across all members.
