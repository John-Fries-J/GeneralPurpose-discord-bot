const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');

module.exports = {
    name: Events.ThreadDelete,
    async execute(thread) {
        if (!thread.guild) return;

        const config = getConfig();
        const channel = findSendableChannel(thread.guild, config.logChannels?.threadDelete, 'logs');
        if (!channel) return;

        const logEmbed = createEmbed({
            title: 'Thread deleted',
            description: `Thread **${thread.name}** was deleted from ${thread.parent || 'unknown channel'}.`,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Error sending thread delete log:', error);
        });
    },
};
