const { getConfig } = require('./config');
const { appendDashboardLog } = require('./dashboardLogs');

function getNamelessConfig(config = getConfig()) {
    const settings = config.namelessmc || {};
    return {
        enabled: settings.enabled === true,
        apiUrl: settings.apiUrl || '',
        apiKey: process.env.NAMELESSMC_API_KEY || settings.apiKey || '',
        syncOnReady: settings.syncOnReady === true,
        syncIntervalMinutes: Number(settings.syncIntervalMinutes || 0),
        link: {
            enabled: settings.link?.enabled !== false,
            integrationName: settings.link?.integrationName || 'Discord',
        },
        roleSync: {
            enabled: settings.roleSync?.enabled === true,
            direction: settings.roleSync?.direction || 'nameless-to-discord',
            removeUnmappedRoles: settings.roleSync?.removeUnmappedRoles === true,
            groupRoleMap: Array.isArray(settings.roleSync?.groupRoleMap) ? settings.roleSync.groupRoleMap : [],
        },
    };
}

function normaliseApiUrl(apiUrl) {
    return String(apiUrl || '').trim().replace(/\/+$/, '');
}

function assertConfigured(settings = getNamelessConfig()) {
    if (!settings.enabled) throw new Error('NamelessMC integration is disabled.');
    if (!settings.apiUrl) throw new Error('NamelessMC apiUrl is not configured.');
    if (!settings.apiKey) throw new Error('NamelessMC apiKey is not configured.');
}

async function namelessRequest(endpoint, options = {}, settings = getNamelessConfig()) {
    assertConfigured(settings);

    const response = await fetch(`${normaliseApiUrl(settings.apiUrl)}/${String(endpoint).replace(/^\/+/, '')}`, {
        method: options.method || 'GET',
        headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok || payload.error === true) {
        throw new Error(payload.message || `NamelessMC API returned ${response.status}.`);
    }

    return payload;
}

function formatDiscordUsername(user) {
    return user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username;
}

async function getInfo(settings) {
    return namelessRequest('info', {}, settings);
}

async function submitRoleList(guild, settings) {
    const roles = [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => ({ id: role.id, name: role.name }));

    await namelessRequest('discord/submit-role-list', {
        method: 'POST',
        body: { roles },
    }, settings);

    appendDashboardLog('NamelessMC role list submitted', { guildId: guild.id, roles: roles.length });
    return roles.length;
}

async function updateBotSettings(client, guild, settings) {
    await namelessRequest('discord/update-bot-settings', {
        method: 'POST',
        body: {
            guild_id: guild.id,
            bot_username: client.user.tag || client.user.username,
            bot_id: client.user.id,
        },
    }, settings);

    appendDashboardLog('NamelessMC bot settings updated', { guildId: guild.id, botId: client.user.id });
}

async function updateDiscordUsernames(guild, settings) {
    const members = await guild.members.fetch();
    const users = [...members.values()]
        .filter(member => !member.user.bot)
        .map(member => ({
            id: member.id,
            name: formatDiscordUsername(member.user),
        }));

    await namelessRequest('discord/update-usernames', {
        method: 'POST',
        body: { users },
    }, settings);

    appendDashboardLog('NamelessMC Discord usernames updated', { guildId: guild.id, users: users.length });
    return users.length;
}

async function verifyDiscordLink(user, code, settings = getNamelessConfig()) {
    return namelessRequest('integration/verify', {
        method: 'POST',
        body: {
            integration: settings.link.integrationName,
            code,
            identifier: user.id,
            username: formatDiscordUsername(user),
        },
    }, settings);
}

async function getUserByDiscordId(discordId, settings = getNamelessConfig()) {
    const integrationName = settings.link.integrationName.toLowerCase();
    const user = await namelessRequest(`users/integration_id:${integrationName}:${discordId}`, {}, settings);
    return user.exists === false ? null : user;
}

function groupMatches(mapping, group) {
    return Boolean(
        mapping.groupId && String(group.id) === String(mapping.groupId)
        || mapping.groupName && String(group.name).toLowerCase() === String(mapping.groupName).toLowerCase(),
    );
}

function getMappedRoleIds(namelessUser, settings) {
    const groups = Array.isArray(namelessUser?.groups) ? namelessUser.groups : [];
    return settings.roleSync.groupRoleMap
        .filter(mapping => mapping.roleId && groups.some(group => groupMatches(mapping, group)))
        .map(mapping => mapping.roleId);
}

async function syncNamelessGroupsToDiscord(member, settings = getNamelessConfig()) {
    if (!settings.roleSync.enabled) return { skipped: true, reason: 'Role sync disabled' };

    const namelessUser = await getUserByDiscordId(member.id, settings);
    if (!namelessUser) return { skipped: true, reason: 'No linked NamelessMC user' };

    const desiredRoleIds = new Set(getMappedRoleIds(namelessUser, settings));
    const managedRoleIds = new Set(settings.roleSync.groupRoleMap.map(mapping => mapping.roleId).filter(Boolean));
    const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
    const added = [];
    const removed = [];

    for (const roleId of desiredRoleIds) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role || member.roles.cache.has(roleId) || role.managed || botMember?.roles.highest.comparePositionTo(role) <= 0) continue;
        await member.roles.add(role, 'NamelessMC group sync');
        added.push(roleId);
    }

    if (settings.roleSync.removeUnmappedRoles) {
        for (const roleId of managedRoleIds) {
            if (desiredRoleIds.has(roleId) || !member.roles.cache.has(roleId)) continue;
            const role = member.guild.roles.cache.get(roleId);
            if (!role || role.managed || botMember?.roles.highest.comparePositionTo(role) <= 0) continue;
            await member.roles.remove(role, 'NamelessMC group sync');
            removed.push(roleId);
        }
    }

    return {
        namelessUser,
        added,
        removed,
    };
}

async function pushDiscordRolesToNameless(member, settings = getNamelessConfig()) {
    const namelessUser = await getUserByDiscordId(member.id, settings);
    if (!namelessUser?.id) return { skipped: true, reason: 'No linked NamelessMC user' };

    const roles = member.roles.cache
        .filter(role => role.id !== member.guild.id)
        .map(role => role.id);

    await namelessRequest('discord/set-roles', {
        method: 'POST',
        body: {
            user: namelessUser.id,
            roles,
        },
    }, settings);

    return { namelessUser, roles };
}

function shouldPullRoles(direction) {
    return ['nameless-to-discord', 'both'].includes(direction);
}

function shouldPushRoles(direction) {
    return ['discord-to-nameless', 'both'].includes(direction);
}

async function syncMember(member, settings = getNamelessConfig()) {
    if (!settings.enabled || !settings.roleSync.enabled || member.user.bot) return { skipped: true };

    const result = {};
    if (shouldPullRoles(settings.roleSync.direction)) {
        result.discord = await syncNamelessGroupsToDiscord(member, settings);
    }
    if (shouldPushRoles(settings.roleSync.direction)) {
        result.nameless = await pushDiscordRolesToNameless(member, settings);
    }

    return result;
}

async function syncGuild(guild, settings = getNamelessConfig()) {
    if (!settings.enabled || !settings.roleSync.enabled) return { synced: 0, skipped: true };

    const members = await guild.members.fetch();
    let synced = 0;
    let failed = 0;

    for (const member of members.values()) {
        if (member.user.bot) continue;
        try {
            await syncMember(member, settings);
            synced += 1;
        } catch (error) {
            failed += 1;
            console.error(`NamelessMC sync failed for ${member.id}:`, error);
        }
    }

    appendDashboardLog('NamelessMC guild sync completed', { guildId: guild.id, synced, failed });
    return { synced, failed };
}

async function bootstrapNameless(client) {
    const settings = getNamelessConfig();
    if (!settings.enabled) return null;

    const guild = client.guilds.cache.get(getConfig().guildId) || client.guilds.cache.first();
    if (!guild) return null;

    await updateBotSettings(client, guild, settings).catch(error => {
        console.error('NamelessMC bot settings update failed:', error);
    });
    await submitRoleList(guild, settings).catch(error => {
        console.error('NamelessMC role list submission failed:', error);
    });

    if (settings.syncOnReady && settings.roleSync.enabled) {
        await syncGuild(guild, settings).catch(error => {
            console.error('NamelessMC ready sync failed:', error);
        });
    }

    if (!settings.syncIntervalMinutes || !settings.roleSync.enabled) return null;
    return setInterval(() => {
        syncGuild(guild, getNamelessConfig()).catch(error => {
            console.error('NamelessMC scheduled sync failed:', error);
        });
    }, Math.max(5, settings.syncIntervalMinutes) * 60 * 1000);
}

module.exports = {
    bootstrapNameless,
    getInfo,
    getNamelessConfig,
    getUserByDiscordId,
    namelessRequest,
    submitRoleList,
    syncGuild,
    syncMember,
    syncNamelessGroupsToDiscord,
    updateBotSettings,
    updateDiscordUsernames,
    verifyDiscordLink,
};
