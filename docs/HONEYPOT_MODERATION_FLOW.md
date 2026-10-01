# Honeypot Moderation Flow

The honeypot alert exposes four staff actions:

- Limit User: requires Manage Roles for the moderator and bot.
- Soft Ban: requires Ban Members for the moderator and bot.
- Time Out: requires Moderate Members for the moderator and bot.
- Ignore: requires an existing moderation permission such as Manage Messages, Moderate Members, Manage Roles, or Ban Members.

Limit User stores a limited-account record before role changes. The record includes the user's restorable role IDs, the configured limited role, the recovery channel, who limited the user, timestamps, and status. The bot never removes `@everyone`, managed roles, or roles at or above the bot's highest role.

## Limited Account Recovery

Use `/honeypot recovery-panel` after configuring `limited_role` and `recovery_channel`. The panel includes a persistent `Regain Access` button. A limited user can click it to restore still-existing unmanaged roles below the bot, remove the limited role, and mark the limited-account record restored.

Recovery is idempotent. Repeated clicks after restoration report that access is already restored and do not duplicate roles.

## Discord Setup

Create a dedicated limited role and configure channel overwrites so limited users can only see the recovery channel. The bot does not automatically rewrite all channel permissions.

The bot role must be above:

- the limited role
- every normal role it may remove or restore
- the target member's highest role

The recovery channel must be visible and sendable by the bot.
