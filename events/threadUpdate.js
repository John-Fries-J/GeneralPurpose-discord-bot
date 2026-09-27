const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');

module.exports = {
    name: Events.ThreadUpdate,
    async execute(oldThread, newThread) {
        if (!oldThread.guild || oldThread.name === newThread.name) return;

        const config = getConfig();
        const channel = findSendableChannel(oldThread.guild, config.logChannels?.threadUpdate, 'logs');
        if (!channel) return;

        const logEmbed = createEmbed({
            title: 'Thread edited',
            description: `**Old name:** ${oldThread.name}\n**New name:** ${newThread.name}\n**Channel:** ${oldThread.parent || 'unknown channel'}`,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Error sending thread update log:', error);
        });
    },
};
