const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        // Ensure the message is from a guild
        if (!message.guild) return;

        // Fetch the log channel from the config or find it by name
        const channelId = config.logChannel;
        const channel = message.guild.channels.cache.get(channelId) || message.guild.channels.cache.find(ch => ch.name === 'logs');

        if (!channel) return;

        try {
            // Fetch the audit logs to find the executor of the deletion
            const logs = await message.guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 1,
            });
            const firstEntry = logs.entries.first();
            if (!firstEntry) return;

            const { executorId, target, targetId } = firstEntry;
            const user = await message.client.users.fetch(executorId);

            // Create the embed message
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

            // Send the embed to the log channel
            await channel.send({ embeds: [logEmbed] });
        } catch (error) {
            console.error('Error fetching audit logs or sending log message:', error);
        }
    }
};
