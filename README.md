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

Utility:

- `/ping` shows bot websocket ping.
- `/user user` shows user information.
- `/server` shows server information.
- `/avatar user` shows a user's avatar.
- `/member role` lists members with a role.
- `/welcome user` sends the configured welcome embed.
- `/help command` lists commands or shows details for one command.

Tickets:

- `/ticket channel role category` posts the ticket panel and saves ticket settings to `config.json`.
- `/close` closes the current ticket channel.
- `/delete` deletes a closed ticket channel.

Suggestions:

- `/suggest suggestion` sends a suggestion, adds vote reactions, and starts a thread.

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

## Author

**John Fries** - [John-Fries-J](https://github.com/John-Fries-J/)
