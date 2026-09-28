const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const language = require('../utils/language');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');
const { startLevelingScheduler } = require('../utils/leveling');
const { startMemberCounterScheduler } = require('../utils/memberCounters');
const { bootstrapNameless } = require('../utils/namelessmc');
const { startPunishmentScheduler } = require('../utils/punishments');
const { startScheduledMessageScheduler } = require('../utils/scheduledMessages');
const { initializeStorage } = require('../utils/store');
const { startTicketScheduler } = require('../utils/tickets');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const config = getConfig();
        console.log(`Ready! Logged in as ${client.user.tag}`);
        await initializeStorage().catch(error => {
            console.error(`[DATABASE] Startup initialization failed: ${error.message}`);
        });
        client.punishmentScheduler = startPunishmentScheduler(client);
        client.memberCounterScheduler = startMemberCounterScheduler(client);
        client.levelingScheduler = startLevelingScheduler(client);
        client.scheduledMessageScheduler = startScheduledMessageScheduler(client);
        client.ticketScheduler = startTicketScheduler(client);
        bootstrapNameless(client).then(scheduler => {
            client.namelessMcScheduler = scheduler;
        }).catch(error => {
            console.error('NamelessMC bootstrap failed:', error);
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
            console.error('Failed to send ready log:', error);
        });
    },
};
