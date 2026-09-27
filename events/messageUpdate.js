const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel, truncate } = require('../utils/discord');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        if (oldMessage.partial) {
            await oldMessage.fetch().catch(() => null);
        }
        if (newMessage.partial) {
            await newMessage.fetch().catch(() => null);
        }

        if (!oldMessage.guild || oldMessage.author?.bot || oldMessage.content === newMessage.content) return;

        const config = getConfig();
        const channel = findSendableChannel(oldMessage.guild, config.logChannels?.editMessage, 'logs');
        if (!channel) return;

        const logEmbed = createEmbed({
            title: `Message edited in #${oldMessage.channel?.name || 'unknown'}`,
            description: `**Author:** ${oldMessage.author?.tag || 'Unknown'}\n**Old:** ${truncate(oldMessage.content, 500)}\n**New:** ${truncate(newMessage.content, 500)}\n[Jump to message](${newMessage.url})`,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Error sending edit log:', error);
        });
    },
};
