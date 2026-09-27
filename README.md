# GeneralPurpose Discord Bot

A Discord.js v14 bot with common moderation, ticket, suggestion, welcome, logging, Twitch notification, and utility commands.

This project is meant to be easy to run and easy to edit. Runtime IDs and secrets live in `config.json`; public-facing text lives in `language.json`.

## Support

For support questions, join the Discord: https://discord.gg/dCCksYzPWU

## Requirements

- Node.js 20 or newer
- A Discord bot token
- Server member, message content, and moderation intents enabled in the Discord Developer Portal

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
- `logChannels`: channel IDs for general, moderation, ticket, suggestion, message, and thread logs
- `roles.autoRoleId` or `roles.autoRoleIds`: role IDs given to new members
- `tickets`: saved by `/ticket`; you can leave this blank on first setup
- `Twitch`: optional Twitch notification settings

4. Edit bot wording in `language.json`.

5. Run the bot:

```bash
npm run run
```

## Docker

Build the image:

```bash
docker build -t generalpurpose-discord-bot .
```

Run with a mounted config:

```bash
docker run --rm -it -v "${PWD}/config.json:/app/config.json" generalpurpose-discord-bot
```

You can also provide the core Discord values with environment variables:

```bash
docker run --rm -it \
  -e DISCORD_TOKEN="your-token" \
  -e DISCORD_CLIENT_ID="your-client-id" \
  -e DISCORD_GUILD_ID="your-server-id" \
  generalpurpose-discord-bot
```

Mount `config.json` when you need channel IDs, roles, tickets, Twitch, or logging.

## Commands

Moderation:

- `/ban user reason duration` bans a user, with an optional temporary duration.
- `/kick user reason` kicks a user from the server.
- `/warn user reason` warns a user and logs it.
- `/unban user_id` unbans a user by Discord ID.
- `/mute user duration reason` times out a user.
- `/unmute user` removes a timeout.
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

- `/ticket setup channel role category` posts the ticket panel and saves ticket settings to `config.json`.
- `/ticket add user` adds a user to the current ticket.
- `/ticket remove user` removes a user from the current ticket.
- `/ticket rename name` renames the current ticket.
- `/ticket transcript` generates a ticket transcript.
- `/close` closes the current ticket channel.
- `/delete` deletes a closed ticket channel.

Suggestions:

- `/suggest suggestion` sends a suggestion, adds vote reactions, and starts a thread.
- `/suggestion approve message_id reason` approves a suggestion.
- `/suggestion deny message_id reason` denies a suggestion.

Config:

- `/config view` shows a safe config summary.
- `/config set-log-channel type channel` updates a log channel.
- `/autorole set role` sets the join autorole.
- `/autorole clear` clears join autoroles.

## Editing Text

Use `language.json` for text users see in embeds, replies, ticket buttons, welcome messages, and the embed watermark.

Every embed uses the footer watermark:

```json
"watermark": {
    "text": "Developed by johnfries",
    "userId": "630070645874622494"
}
```

Discord embed footers cannot ping users, so the user ID is included as footer text.

## Checks

Run a syntax check before committing:

```bash
npm test
```

## Notes

- `config.json` is ignored by git so tokens and server IDs stay local.
- Slash commands refresh automatically when the bot becomes ready.
- No database is required; setup commands save the IDs they need into `config.json`.
- Privileged slash commands use Discord default member permissions, so Discord hides them from users without the required server permission. Discord applies this at the command level, not per subcommand.

## Author

**John Fries** - [John-Fries-J](https://github.com/John-Fries-J/)
