const path = require('node:path');
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { getConfig } = require('./utils/config');
const { assertValidConfig } = require('./utils/configValidation');
const { loadCommands } = require('./utils/commands');
const { destroyAllMusicVoiceConnections } = require('./services/musicLifecycle');
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
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});
client.commands = new Collection();
let dashboardServer = null;

for (const { command } of loadCommands()) {
    client.commands.set(command.data.name, command);
    console.log(`[COMMAND] /${command.data.name}`);
}

dashboardServer = startDashboard(client);

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

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] Received ${signal}. Closing Discord client and dashboard.`);

    if (client.punishmentScheduler) {
        clearInterval(client.punishmentScheduler);
    }
    if (client.memberCounterScheduler) {
        clearInterval(client.memberCounterScheduler);
    }
    if (client.mediaAnnouncementScheduler) {
        clearInterval(client.mediaAnnouncementScheduler);
    }
    if (client.levelingScheduler) {
        clearInterval(client.levelingScheduler);
    }
    if (client.scheduledMessageScheduler) {
        clearInterval(client.scheduledMessageScheduler);
    }
    if (client.ticketScheduler) {
        clearInterval(client.ticketScheduler);
    }
    if (client.namelessMcScheduler) {
        clearInterval(client.namelessMcScheduler);
    }
    if (client.scheduler) {
        client.scheduler.stop();
    }
    destroyAllMusicVoiceConnections(client);

    if (dashboardServer) {
        await new Promise(resolve => dashboardServer.close(resolve));
    }

    client.destroy();
    process.exit(exitCode);
}

process.on('SIGINT', () => {
    shutdown('SIGINT').catch(error => {
        console.error('[SHUTDOWN] Failed during SIGINT shutdown:', error);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(error => {
        console.error('[SHUTDOWN] Failed during SIGTERM shutdown:', error);
        process.exit(1);
    });
});

process.on('unhandledRejection', error => {
    console.error('[PROCESS] Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('[PROCESS] Uncaught exception:', error);
    shutdown('uncaughtException', 1).catch(() => process.exit(1));
});
