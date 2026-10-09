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

- Use `/level calibration-preview job_id:<completed-job-id> profile:ProBot-inspired default` to create a background replay job under a different XP profile without rescanning Discord and without changing XP or roles.
- Use `/level calibration-preview job_id:<completed-job-id> profile:Custom options min_xp:<n> max_xp:<n> cooldown:<seconds> formula:<formula>` to test specific XP settings. Add `users:<ids-or-mentions>` to restrict the report to those users only.
- Use `/level calibration-fit job_id:<completed-job-id>` after configuring reward-role mappings to compare bounded candidate profiles against role-derived minimum-level evidence. The command reports training and held-out validation agreement, minimum violations, tentative upper-bound overestimates, and median/p90 interval error.
- Use `/level calibration-status job_id:<calibration-job-id>` to inspect progress or completed results. Add `export:CSV` or `export:JSON` to status for private detailed output. Use `/level calibration-cancel job_id:<calibration-job-id>` to request safe cancellation.
- Calibration jobs are persistent and restart-resumable. Only one active calibration job can run for the same completed import at a time.
- Calibration is read-only: it streams `level_import_messages`, recalculates hypothetical XP from stored message IDs and timestamps, and does not write reconciliation records, processed-message rows, live XP balances, config, or Discord roles.

## Calibration Audit Notes

- Stored import messages are replayed globally by `created_at, message_id`, so per-user cooldowns cross channel boundaries in chronological order.
- Text cooldowns are per user. Bot and webhook messages are excluded from live text XP and historical imports.
- Alternative calibration profiles recalculate XP from the stored message ID and proposed XP range; they do not reuse the original stored `xp_amount`.
- Current leveling configuration is used to discover role mappings and ignored import context, but each preview job stores the proposed calibration settings separately so current XP values do not override the proposed XP range, cooldown, formula, or base.
- Mapped reward roles are interpreted as confirmed minimum levels. The next mapped milestone is reported only as a tentative upper bound because historical replacement-style roles, manual role edits, and changed mappings can break a strict interval.
- Evidence-quality groups are diagnostic only. "Substantial surviving history" means at least 250 accessible messages or 100 cooldown-adjusted messages spanning at least 7 days. "Questionable history coverage" means no surviving messages, a very short observed history window for a high milestone, partial member evidence, or incomplete import channel coverage. Low-message users are still shown and are not discarded.
- If multiple materially different profiles score nearly the same, the result explicitly warns that the role evidence does not identify a unique XP model.

## Required Bot Permissions

- `View Channel` and `Read Message History` for channels to scan.
- `Manage Roles` for reward-role sync, with the bot role above every managed reward role.
- `Send Messages` for level announcements and dashboard-triggered feedback where applicable.
- `Guild Members` intent is needed for full role recovery across all members.
