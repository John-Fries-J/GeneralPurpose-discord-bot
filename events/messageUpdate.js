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

        const guild = newMessage.guild || oldMessage.guild;
        const author = newMessage.author || oldMessage.author;
        const oldContent = String(oldMessage.content || '').trim();
        const newContent = String(newMessage.content || '').trim();

        if (!guild || !author || author.bot || oldContent === newContent || (!oldContent && !newContent)) return;

        await sendLog(guild, {
            type: 'messageUpdate',
            title: `Message edited in #${newMessage.channel?.name || oldMessage.channel?.name || 'unknown'}`,
            color: 'orange',
            user: author,
            fields: [
                { name: 'Author', value: `${author.tag || author.username} (${author.id})`, inline: true },
                { name: 'Channel', value: newMessage.channel ? `<#${newMessage.channel.id}>` : 'Unknown', inline: true },
                { name: 'Old message', value: truncate(oldContent, 1024) },
                { name: 'New message', value: truncate(newContent, 1024) },
                { name: 'Jump', value: `[Go to message](${newMessage.url})` },
            ],
        }).catch(error => {
            console.error('Error sending edit log:', error);
        });
    },
};
