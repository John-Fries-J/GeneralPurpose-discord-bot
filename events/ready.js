const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const language = require('../utils/language');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');
const { getGuildSettings } = require('../utils/guildConfig');
const { bootstrapNameless } = require('../utils/namelessmc');
const { initializeStorage } = require('../utils/store');
const { createScheduler } = require('../services/scheduler');
const { reconcileJoinToCreate } = require('../utils/joinToCreate');
const { logger } = require('../utils/logger');

const readyLogger = logger.child({ component: 'ready' });

async function initializeReadyStorage(client, exitProcess = process.exit) {
    try {
        await initializeStorage();
        return true;
    } catch (error) {
        readyLogger.error('Fatal database startup initialization failed', { error });
        process.exitCode = 1;
        try {
            client.destroy?.();
        } catch (destroyError) {
            readyLogger.error('Failed to destroy client after database startup failure', { error: destroyError });
        }
        exitProcess(1);
        return false;
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    initializeReadyStorage,
    async execute(client) {
        const config = getConfig();
        readyLogger.info('Discord client ready', { userTag: client.user.tag, guildCount: client.guilds.cache.size });
        if (!await initializeReadyStorage(client)) return;
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

        const guild = client.guilds.cache.get(config.guildId);
        const guildConfig = guild ? await getGuildSettings(guild.id) : config;
        const readyLogChannelId = guildConfig.logChannels?.logChannel || config.logChannels?.logChannel;
        const channel = findSendableChannel(guild, readyLogChannelId, 'logs')
            || client.channels.cache.get(readyLogChannelId);

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
