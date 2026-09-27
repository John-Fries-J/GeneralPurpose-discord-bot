const { Events } = require('discord.js');
const { handleAutoModMessage } = require('../utils/automod');
const { handleHoneypotMessage } = require('../utils/honeypot');
const { awardTextXp } = require('../utils/leveling');
const { addUserHistory } = require('../utils/store');
const { touchTicketActivity } = require('../utils/tickets');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message.guild || message.author?.bot) return;

        const handledHoneypot = await handleHoneypotMessage(message);
        if (handledHoneypot) return;

        const handledAutoMod = await handleAutoModMessage(message);
        if (handledAutoMod) return;

        await awardTextXp(message).catch(error => {
            console.error('Failed to award text XP:', error);
        });

        await touchTicketActivity(message).catch(error => {
            console.error('Failed to update ticket activity:', error);
        });

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
