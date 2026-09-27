const { Events } = require('discord.js');
const { refreshMemberCounters } = require('../utils/memberCounters');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size
            || oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp;
        if (!rolesChanged) return;

        await refreshMemberCounters(newMember.guild).catch(error => {
            console.error('Failed to refresh counters after member update:', error);
        });
    },
};
