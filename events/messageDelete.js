const { Events, EmbedBuilder } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (!message.guild || message.author?.bot) return;
        const channelId = config.logChannels?.MessageDelete;
        const channel = message.guild.channels.cache.get(channelId) || message.guild.channels.cache.find(ch => ch.name === 'logs');
        if (!channel) {
            console.warn('Logging channel not found for message deletion.');
            return;
        }
        const messageContent = message.content || '[No content]';
        const logEmbed = new EmbedBuilder()
            .setTitle(`Message deleted in #${message.channel.name}`)
            .setDescription(`**Author:** ${message.author.tag}\n**Message:** ${messageContent}\n**Location:** [Jump to message](${message.url})`)
            .setColor(blue)
            .setTimestamp();

        try {
            await channel.send({ embeds: [logEmbed] });
        } catch (error) {
            console.error('Error sending log message:', error);
        }
    }
};
