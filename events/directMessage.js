const { ChannelType, Events } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { getConfig } = require('../utils/config');
const { truncate } = require('../utils/discord');

async function getDirectMessageLogChannel(client) {
    const config = getConfig();
    const channelId = config.logChannels?.directMessage || config.logChannels?.dmLog;
    if (!channelId) return null;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.send ? channel : null;
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.partial) {
            await message.fetch().catch(() => null);
        }

        if (message.author?.bot || message.channel?.type !== ChannelType.DM) return;

        const channel = await getDirectMessageLogChannel(message.client);
        if (!channel) return;

        const attachmentList = message.attachments?.size
            ? message.attachments.map(attachment => attachment.url).join('\n')
            : 'None';

        const author = { name: `${message.author.tag} (${message.author.id})` };
        const iconURL = message.author.displayAvatarURL?.({ extension: 'png', size: 64 });
        if (iconURL) author.iconURL = iconURL;

        const embed = createEmbed({
            title: 'Direct Message Received',
            author,
            color: 'blue',
            fields: [
                { name: 'From', value: `${message.author.tag} (${message.author.id})`, inline: true },
                { name: 'Created', value: message.createdAt.toISOString(), inline: true },
                { name: 'Message', value: truncate(message.content, 1024) },
                { name: 'Attachments', value: truncate(attachmentList, 1024) },
            ],
        });

        await channel.send({ embeds: [embed] }).catch(error => {
            console.error('Failed to send DM log:', error);
        });
    },
};
