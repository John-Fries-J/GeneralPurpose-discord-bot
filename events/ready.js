const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const language = require('../utils/language');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');
const { bootstrapNameless } = require('../utils/namelessmc');
const { initializeStorage } = require('../utils/store');
const { createScheduler } = require('../services/scheduler');
const { reconcileJoinToCreate } = require('../utils/joinToCreate');
const { logger } = require('../utils/logger');

const readyLogger = logger.child({ component: 'ready' });

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const config = getConfig();
        readyLogger.info('Discord client ready', { userTag: client.user.tag, guildCount: client.guilds.cache.size });
        await initializeStorage().catch(error => {
            readyLogger.error('Database startup initialization failed', { error });
        });
        client.scheduler = createScheduler(client, { logger });
        client.scheduler.start();
        reconcileJoinToCreate(client).then(results => {
            const changed = results.filter(result => result.records > 0);
            if (changed.length) readyLogger.info('Reconciled join-to-create state', { results: changed });
        }).catch(error => {
            readyLogger.error('Join-to-create startup reconciliation failed', { error });
        });
        bootstrapNameless(client).then(scheduler => {
            client.namelessMcScheduler = scheduler;
        }).catch(error => {
            readyLogger.error('NamelessMC bootstrap failed', { error });
        });

        if (config.statusName) {
            client.user.setPresence({ activities: [{ name: config.statusName }] });
        }

        const channel = findSendableChannel(client.guilds.cache.get(config.guildId), config.logChannels?.logChannel, 'logs')
            || client.channels.cache.get(config.logChannels?.logChannel);

        if (!channel?.send) return;

        const logEmbed = createEmbed({
            title: language.status.readyTitle,
            description: language.status.readyDescription,
            color: 'green',
        });

        channel.send({ embeds: [logEmbed] }).catch(error => {
            readyLogger.error('Failed to send ready log', { error });
        });
    },
};
