const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel, truncate } = require('../utils/discord');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (message.partial) {
            await message.fetch().catch(() => null);
        }

        if (!message.guild || message.author?.bot) return;

        const config = getConfig();
        const channelId = config.logChannels?.messageDelete;
        const channel = findSendableChannel(message.guild, channelId, 'logs');
        if (!channel) return;

        const logEmbed = createEmbed({
            title: `Message deleted in #${message.channel?.name || 'unknown'}`,
            description: `**Author:** ${message.author?.tag || 'Unknown'}\n**Message:** ${truncate(message.content)}\n**Channel:** ${message.channel}`,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Error sending delete log:', error);
        });
    },
};
