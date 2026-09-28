const { Events } = require('discord.js');
const { truncate } = require('../utils/discord');
const { sendLog } = require('../utils/logging');

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

        await sendLog(oldMessage.guild, {
            type: 'messageUpdate',
            title: `Message edited in #${oldMessage.channel?.name || 'unknown'}`,
            color: 'orange',
            user: oldMessage.author,
            fields: [
                { name: 'Author', value: oldMessage.author ? `${oldMessage.author.tag} (${oldMessage.author.id})` : 'Unknown', inline: true },
                { name: 'Channel', value: oldMessage.channel ? `<#${oldMessage.channel.id}>` : 'Unknown', inline: true },
                { name: 'Old message', value: truncate(oldMessage.content, 1024) },
                { name: 'New message', value: truncate(newMessage.content, 1024) },
                { name: 'Jump', value: `[Go to message](${newMessage.url})` },
            ],
        }).catch(error => {
            console.error('Error sending edit log:', error);
        });
    },
};
