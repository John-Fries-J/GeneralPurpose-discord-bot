const { Events } = require('discord.js');
const { refreshMemberCounters } = require('../utils/memberCounters');
const { getNamelessConfig, syncMember } = require('../utils/namelessmc');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size
            || oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp;
        if (!rolesChanged) return;

        await refreshMemberCounters(newMember.guild).catch(error => {
            console.error('Failed to refresh counters after member update:', error);
        });

        const namelessSettings = getNamelessConfig();
        if (['discord-to-nameless', 'both'].includes(namelessSettings.roleSync.direction)) {
            await syncMember(newMember, namelessSettings).catch(error => {
                console.error('Failed to sync NamelessMC member after role update:', error);
            });
        }
    },
};
