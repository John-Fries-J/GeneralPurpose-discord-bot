const { getVoiceConnection } = require('@discordjs/voice');
const { getConfig } = require('../utils/config');
const { stop } = require('../utils/music');

const idleDisconnectTimers = new Map();
const defaultIdleTimeoutMs = 60_000;

function getIdleTimeoutMs(config = getConfig()) {
    const value = Number(config.music?.idleTimeoutMs ?? defaultIdleTimeoutMs);
    return Number.isInteger(value) && value >= 5_000 ? value : defaultIdleTimeoutMs;
}

function hasHumanMembers(channel) {
    if (channel?.members?.some) return channel.members.some(member => !member.user?.bot);
    return [...(channel?.members?.values?.() || [])].some(member => !member.user?.bot);
}

async function fetchVoiceChannel(guild, channelId) {
    if (!guild || !channelId) return null;
    return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

function cancelMusicIdleDisconnect(guildId) {
    const timer = idleDisconnectTimers.get(guildId);
    if (!timer) return false;
    clearTimeout(timer);
    idleDisconnectTimers.delete(guildId);
    return true;
}

function scheduleMusicIdleDisconnect(guild, channelId, timeoutMs = getIdleTimeoutMs(), stopFn = stop) {
    if (!guild?.id || !channelId) return false;
    cancelMusicIdleDisconnect(guild.id);

    const timer = setTimeout(async () => {
        idleDisconnectTimers.delete(guild.id);
        const channel = await fetchVoiceChannel(guild, channelId);
        if (channel && hasHumanMembers(channel)) return;
        stopFn(guild.id);
    }, timeoutMs);
    idleDisconnectTimers.set(guild.id, timer);
    return true;
}

async function refreshMusicIdleDisconnect(guild, channelId) {
    if (!guild?.id || !channelId) return false;
    const channel = await fetchVoiceChannel(guild, channelId);
    if (!channel) {
        stop(guild.id);
        return true;
    }
    if (hasHumanMembers(channel)) {
        cancelMusicIdleDisconnect(guild.id);
        return false;
    }
    return scheduleMusicIdleDisconnect(guild, channelId);
}

async function handleMusicVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild?.id) return false;

    const connection = getVoiceConnection(guild.id);
    const channelId = connection?.joinConfig?.channelId;
    if (!channelId) return false;

    const member = newState.member || oldState.member;
    if (member?.id === newState.client?.user?.id && oldState.channelId === channelId && newState.channelId !== channelId) {
        cancelMusicIdleDisconnect(guild.id);
        stop(guild.id);
        return true;
    }

    if (newState.channelId === channelId && oldState.channelId !== channelId && !member?.user?.bot) {
        cancelMusicIdleDisconnect(guild.id);
        return true;
    }

    if (oldState.channelId === channelId && newState.channelId !== channelId) {
        await refreshMusicIdleDisconnect(guild, channelId);
        return true;
    }

    return false;
}

function destroyAllMusicVoiceConnections(client) {
    for (const timer of idleDisconnectTimers.values()) clearTimeout(timer);
    idleDisconnectTimers.clear();

    for (const guild of client.guilds.cache.values()) {
        stop(guild.id);
    }
}

module.exports = {
    cancelMusicIdleDisconnect,
    destroyAllMusicVoiceConnections,
    getIdleTimeoutMs,
    handleMusicVoiceStateUpdate,
    refreshMusicIdleDisconnect,
    scheduleMusicIdleDisconnect,
    __testing: {
        idleDisconnectTimers,
    },
};
