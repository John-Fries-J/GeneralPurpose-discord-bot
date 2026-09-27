const { Events } = require('discord.js');
const { addUserHistory } = require('../utils/store');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message.guild || message.author?.bot) return;

        await addUserHistory({
            guildId: message.guild.id,
            userId: message.author.id,
            userTag: message.author.tag,
            type: 'message',
            summary: message.content || '[No text content]',
            channelId: message.channelId,
            metadata: {
                messageId: message.id,
            },
        }).catch(error => {
            console.error('Failed to record message history:', error);
        });
    },
};
