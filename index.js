const path = require('node:path');
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { getConfig } = require('./utils/config');
const { assertValidConfig } = require('./utils/configValidation');
const { loadCommands } = require('./utils/commands');
const { startDashboard } = require('./web/dashboard');

const config = getConfig();
assertValidConfig(config, { requireToken: true });
const { token } = config;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});
client.commands = new Collection();

for (const { command } of loadCommands()) {
    client.commands.set(command.data.name, command);
    console.log(`[COMMAND] /${command.data.name}`);
}

startDashboard(client);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);

    if (!event?.name || typeof event.execute !== 'function') {
        console.warn(`[WARNING] The event at ${filePath} is missing a required "name" or "execute" property.`);
        continue;
    }

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
        console.log(`[EVENT] ${event.name} (once)`);
    } else {
        client.on(event.name, (...args) => event.execute(...args));
        console.log(`[EVENT] ${event.name}`);
    }
}

if (!token) {
    console.error('[ERROR] No token provided in config.json');
    process.exit(1);
}

client.login(token);
