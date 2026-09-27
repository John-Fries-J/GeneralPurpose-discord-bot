const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const language = require('../utils/language');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');
const { startMemberCounterScheduler } = require('../utils/memberCounters');
const { startPunishmentScheduler } = require('../utils/punishments');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        const config = getConfig();
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.punishmentScheduler = startPunishmentScheduler(client);
        client.memberCounterScheduler = startMemberCounterScheduler(client);

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
