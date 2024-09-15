const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (!message.guild) return;
        const channelId = config.logChannels.MessageDelete;
        const channel = message.guild.channels.cache.get(channelId) || message.guild.channels.cache.find(ch => ch.name === 'logs');

        if (!channel) return;

        try {
            const logs = await message.guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 1,
            });
            const firstEntry = logs.entries.first();
            if (!firstEntry) return;
            const { executorId, target, targetId } = firstEntry;
            const user = await message.client.users.fetch(executorId);
            let description;
            if (target && message.content) {
                description = `Message deleted by ${user.tag}\nMessage by ${target.tag}: ${message.content}`;
            } else {
                description = `Message with ID ${targetId} was deleted by ${user.tag}.`;
            }
            const logEmbed = new EmbedBuilder()
                .setTitle(`Message deleted in #${message.channel.name}`)
                .setDescription(description)
                .setColor(blue)
                .setTimestamp();
            await channel.send({ embeds: [logEmbed] });
        } catch (error) {
            console.error('Error fetching audit logs or sending log message:', error);
        }
    }
};
