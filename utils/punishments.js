const { readState, removeTempBan, removeTempMute } = require('./store');
const { appendDashboardLog } = require('./dashboardLogs');
const { getOrCreateMuteRole, restoreMutedMember } = require('./moderation');

const checkIntervalMs = 60 * 1000;

async function expireTempBans(client) {
    const now = Date.now();
    const expired = (await readState()).tempBans.filter(record => record.expiresAt <= now);

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
}

async function expireTempMutes(client) {
    const now = Date.now();
    const expired = (await readState()).tempMutes.filter(record => record.expiresAt <= now);

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
}

function startPunishmentScheduler(client) {
    const run = () => {
        expireTempBans(client).catch(error => console.error('Temp ban scheduler failed:', error));
        expireTempMutes(client).catch(error => console.error('Temp mute scheduler failed:', error));
    };

    run();
    return setInterval(run, checkIntervalMs);
}

module.exports = {
    startPunishmentScheduler,
};
