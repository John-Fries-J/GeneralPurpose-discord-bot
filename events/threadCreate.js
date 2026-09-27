const { Events } = require('discord.js');
const { sendLog } = require('../utils/logging');

module.exports = {
    name: Events.ThreadCreate,
    async execute(thread) {
        if (!thread.guild) return;

        await sendLog(thread.guild, {
            type: 'threadCreate',
            title: 'Thread created',
            color: 'blue',
            fields: [
                { name: 'Thread', value: thread.name, inline: true },
                { name: 'Parent', value: thread.parent ? `<#${thread.parent.id}>` : 'Unknown', inline: true },
                { name: 'Owner', value: thread.ownerId ? `<@${thread.ownerId}> (${thread.ownerId})` : 'Unknown' },
            ],
        }).catch(error => {
            console.error('Error sending thread create log:', error);
        });
    },
};
