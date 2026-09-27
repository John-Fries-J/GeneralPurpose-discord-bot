const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');

module.exports = {
    name: Events.ThreadCreate,
    async execute(thread) {
        if (!thread.guild) return;

        const config = getConfig();
        const channel = findSendableChannel(thread.guild, config.logChannels?.threadCreate, 'logs');
        if (!channel) return;

        const logEmbed = createEmbed({
            title: 'Thread created',
            description: `Thread **${thread.name}** was created in ${thread.parent || 'unknown channel'} by ${thread.ownerId ? `<@${thread.ownerId}>` : 'unknown user'}.`,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Error sending thread create log:', error);
        });
    },
};
