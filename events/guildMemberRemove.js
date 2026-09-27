const { Events } = require('discord.js');
const { refreshMemberCounters } = require('../utils/memberCounters');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        await refreshMemberCounters(member.guild).catch(error => {
            console.error('Failed to refresh counters after member leave:', error);
        });
    },
};
