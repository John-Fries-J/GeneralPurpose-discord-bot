const { listExpiredTempBans, listExpiredTempMutes, listExpiredTempRoles, removeTempBan, removeTempMute, removeTempRole } = require('./store');
const { appendDashboardLog } = require('./dashboardLogs');
const { getOrCreateMuteRole, restoreMutedMember } = require('./moderation');

const checkIntervalMs = 60 * 1000;

async function expireTempBans(client) {
    const now = Date.now();
    const expired = await listExpiredTempBans(now);

    for (const record of expired) {
        const guild = client.guilds.cache.get(record.guildId);
        if (!guild) continue;

        try {
            await guild.members.unban(record.userId, 'Automatic unban after temporary ban expired');
            await removeTempBan(record.guildId, record.userId);
            appendDashboardLog('Temporary ban expired', { guildId: record.guildId, userId: record.userId });
        } catch (error) {
            console.error(`Automatic unban failed for ${record.userId}:`, error);
        }
    }

    return expired.length;
}

async function expireTempMutes(client) {
    const now = Date.now();
    const expired = await listExpiredTempMutes(now);

    for (const record of expired) {
        const guild = client.guilds.cache.get(record.guildId);
        if (!guild) continue;

        try {
            const member = await guild.members.fetch(record.userId);
            const muteRole = await getOrCreateMuteRole(guild);
            await restoreMutedMember(member, muteRole, record.removedRoleIds || [], 'Automatic unmute after temporary mute expired');
            await removeTempMute(record.guildId, record.userId);
            appendDashboardLog('Temporary mute expired', { guildId: record.guildId, userId: record.userId });
        } catch (error) {
            console.error(`Automatic unmute failed for ${record.userId}:`, error);
        }
    }

    return expired.length;
}

async function expireTempRoles(client) {
    const expired = await listExpiredTempRoles();

    for (const record of expired) {
        const guild = client.guilds.cache.get(record.guildId);
        if (!guild) continue;

        try {
            const member = await guild.members.fetch(record.userId).catch(() => null);
            if (member?.roles.cache.has(record.roleId)) {
                await member.roles.remove(record.roleId, 'Temporary role expired');
            }
            await removeTempRole(record.guildId, record.userId, record.roleId);
            appendDashboardLog('Temporary role expired', { guildId: record.guildId, userId: record.userId, roleId: record.roleId });
        } catch (error) {
            console.error(`Temporary role expiry failed for ${record.userId}/${record.roleId}:`, error);
        }
    }

    return expired.length;
}

function startPunishmentScheduler(client) {
    const run = () => {
        expireTempBans(client).catch(error => console.error('Temp ban scheduler failed:', error));
        expireTempMutes(client).catch(error => console.error('Temp mute scheduler failed:', error));
        expireTempRoles(client).catch(error => console.error('Temp role scheduler failed:', error));
    };

    run();
    return setInterval(run, checkIntervalMs);
}

module.exports = {
    expireTempBans,
    expireTempMutes,
    expireTempRoles,
    startPunishmentScheduler,
};
