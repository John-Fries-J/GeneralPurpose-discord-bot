const { Events } = require('discord.js');
const { truncate } = require('../utils/discord');
const { sendLog } = require('../utils/logging');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (message.partial) {
            await message.fetch().catch(() => null);
        }

        if (!message.guild || message.author?.bot) return;

        const attachmentList = message.attachments?.size
            ? message.attachments.map(attachment => attachment.url).join('\n')
            : 'None';

        await sendLog(message.guild, {
            type: 'messageDelete',
            title: `Message deleted in #${message.channel?.name || 'unknown'}`,
            color: 'red',
            user: message.author,
            fields: [
                { name: 'Author', value: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown', inline: true },
                { name: 'Channel', value: message.channel ? `<#${message.channel.id}>` : 'Unknown', inline: true },
                { name: 'Message', value: truncate(message.content, 1024) },
                { name: 'Attachments', value: truncate(attachmentList, 1024) },
            ],
        }).catch(error => {
            console.error('Error sending delete log:', error);
        });
    },
};
