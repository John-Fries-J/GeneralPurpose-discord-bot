const { Events } = require('discord.js');
const { sendLog } = require('../utils/logging');

module.exports = {
    name: Events.ThreadUpdate,
    async execute(oldThread, newThread) {
        if (!oldThread.guild || oldThread.name === newThread.name) return;

        await sendLog(oldThread.guild, {
            type: 'threadUpdate',
            title: 'Thread edited',
            color: 'orange',
            fields: [
                { name: 'Old name', value: oldThread.name, inline: true },
                { name: 'New name', value: newThread.name, inline: true },
                { name: 'Parent', value: oldThread.parent ? `<#${oldThread.parent.id}>` : 'Unknown' },
            ],
        }).catch(error => {
            console.error('Error sending thread update log:', error);
        });
    },
};
