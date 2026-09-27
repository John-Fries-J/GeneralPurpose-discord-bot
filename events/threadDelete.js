const { Events } = require('discord.js');
const { sendLog } = require('../utils/logging');

module.exports = {
    name: Events.ThreadDelete,
    async execute(thread) {
        if (!thread.guild) return;

        await sendLog(thread.guild, {
            type: 'threadDelete',
            title: 'Thread deleted',
            color: 'red',
            fields: [
                { name: 'Thread', value: thread.name, inline: true },
                { name: 'Parent', value: thread.parent ? `<#${thread.parent.id}>` : 'Unknown', inline: true },
            ],
        }).catch(error => {
            console.error('Error sending thread delete log:', error);
        });
    },
};
