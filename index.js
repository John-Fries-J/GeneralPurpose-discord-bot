const path = require('node:path');
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { getConfig } = require('./utils/config');
const { assertValidConfig } = require('./utils/configValidation');
const { loadCommands } = require('./utils/commands');
const { destroyAllMusicVoiceConnections } = require('./services/musicLifecycle');
const { startDashboard } = require('./web/dashboard');
const { logger } = require('./utils/logger');
const { closeDatabase } = require('./database');

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
    logger.info('Command loaded', { component: 'commands', command: command.data.name });
}

dashboardServer = startDashboard(client);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);

    if (!event?.name || typeof event.execute !== 'function') {
        logger.warn('Event module missing required exports', { component: 'events', filePath });
        continue;
    }

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
        logger.info('Event loaded', { component: 'events', event: event.name, once: true });
    } else {
        client.on(event.name, (...args) => event.execute(...args));
        logger.info('Event loaded', { component: 'events', event: event.name, once: false });
    }
}

if (!token) {
    logger.error('No Discord token configured', { component: 'startup' });
    process.exit(1);
}

client.login(token);

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown requested', { component: 'shutdown', signal });

    let finalExitCode = exitCode;

    try {
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
            await new Promise((resolve, reject) => dashboardServer.close(error => (error ? reject(error) : resolve())));
        }

        client.destroy();
    } catch (error) {
        finalExitCode = 1;
        logger.error('Shutdown cleanup failed', { component: 'shutdown', signal, error });
    } finally {
        try {
            closeDatabase();
        } catch (error) {
            finalExitCode = 1;
            logger.error('Database close failed during shutdown', { component: 'shutdown', signal, error });
        }
    }

    process.exit(finalExitCode);
}

process.on('SIGINT', () => {
    shutdown('SIGINT').catch(error => {
        logger.error('Shutdown failed', { component: 'shutdown', signal: 'SIGINT', error });
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(error => {
        logger.error('Shutdown failed', { component: 'shutdown', signal: 'SIGTERM', error });
        process.exit(1);
    });
});

process.on('unhandledRejection', error => {
    logger.error('Unhandled promise rejection', { component: 'process', error });
});

process.on('uncaughtException', error => {
    logger.error('Uncaught exception', { component: 'process', error });
    shutdown('uncaughtException', 1).catch(() => process.exit(1));
});
