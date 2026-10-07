const { PermissionFlagsBits } = require('discord.js');
const {
    enqueue,
    getMusicErrorMessage,
    getMusicSettings,
    getQueueSummary,
    moveQueuedTrack,
    pause,
    removeQueuedTrack,
    resolvePlayableTrack,
    resume,
    setVolume,
    skip,
    stop,
} = require('../utils/music');
const { fetchGuild, fetchGuildMember } = require('./voiceControlService');

class MusicControlError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'MusicControlError';
        this.code = code;
        this.status = status;
    }
}

function memberHasMusicBypass(member) {
    return member?.permissions?.has?.(PermissionFlagsBits.Administrator)
        || member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);
}

function isActiveMusicSummary(summary) {
    return Boolean(summary?.voiceChannelId || summary?.current || summary?.tracks?.length);
}

function memberCanControlMusic(member, summary) {
    if (!summary?.voiceChannelId) return true;
    return member?.voice?.channelId === summary.voiceChannelId || memberHasMusicBypass(member);
}

function serializeTrack(track, index = null) {
    if (!track) return null;
    return {
        index,
        title: track.title || 'Unknown track',
        url: track.url || null,
        source: track.source || null,
        requesterId: track.requestedBy || null,
        thumbnail: track.thumbnail || null,
        durationMs: Number.isFinite(track.durationMs) ? track.durationMs : null,
        author: track.author || null,
    };
}

function serializeMusicSummary(summary) {
    return {
        active: isActiveMusicSummary(summary),
        current: serializeTrack(summary.current),
        queue: (summary.tracks || []).map((track, index) => serializeTrack(track, index)),
        volume: summary.volume ?? 100,
        paused: summary.paused === true,
        connectionState: summary.connectionState || null,
        connectionReady: summary.connectionReady === true,
        voiceChannelId: summary.voiceChannelId || null,
        currentProgressMs: summary.currentProgressMs ?? null,
        startedAt: summary.startedAt || null,
    };
}

async function getMusicState(client, guildId, userId) {
    const guild = await fetchGuild(client, guildId);
    const member = await fetchGuildMember(guild, userId);
    const summary = getQueueSummary(guild.id);
    const authorized = !isActiveMusicSummary(summary) || memberCanControlMusic(member, summary);

    return {
        ok: true,
        guild: { id: guild.id, name: guild.name || guild.id },
        authorized,
        reason: authorized ? null : 'join_playback_voice',
        userVoiceChannelId: member.voice?.channelId || null,
        music: serializeMusicSummary(summary),
    };
}

async function requireMusicAccess(client, guildId, userId, { requireActive = false, allowStarting = false } = {}) {
    const guild = await fetchGuild(client, guildId);
    const member = await fetchGuildMember(guild, userId);
    const summary = getQueueSummary(guild.id);

    if (requireActive && !isActiveMusicSummary(summary)) {
        throw new MusicControlError('no_active_music', 'There is no active music session.', 404);
    }

    if (summary.voiceChannelId && !memberCanControlMusic(member, summary)) {
        throw new MusicControlError('wrong_voice_channel', 'Join the active playback voice channel before using music controls.', 403);
    }

    if (!summary.voiceChannelId && allowStarting && !member.voice?.channel) {
        throw new MusicControlError('not_in_voice', 'Join a voice channel first.', 403);
    }

    return { guild, member, summary };
}

function asNoopTextChannel(channelId = null) {
    return {
        id: channelId,
        send: async () => null,
    };
}

async function addTrackFromActivity(client, guildId, userId, query, context = {}) {
    const value = String(query || '').trim();
    if (value.length < 1 || value.length > 300) {
        throw new MusicControlError('invalid_query', 'Enter a URL or search query up to 300 characters.', 400);
    }

    const settings = getMusicSettings();
    if (!settings.enabled) throw new MusicControlError('music_disabled', 'Music is currently disabled in config.', 403);

    const { guild, member } = await requireMusicAccess(client, guildId, userId, { allowStarting: true });
    const track = await resolvePlayableTrack(value, userId).catch(error => {
        throw new MusicControlError('track_lookup_failed', getMusicErrorMessage(error), error?.status || 400);
    });
    await enqueue({
        guild,
        member,
        user: { id: userId },
        channel: asNoopTextChannel(context.channelId),
    }, track).catch(error => {
        throw new MusicControlError('enqueue_failed', getMusicErrorMessage(error), error?.status || 400);
    });

    return (await getMusicState(client, guild.id, userId)).music;
}

async function pauseMusic(client, guildId, userId) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    const result = pause(guildId);
    if (!result?.ok) throw new MusicControlError('nothing_playing', 'There is no active track to pause.', 404);
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function resumeMusic(client, guildId, userId) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    const result = resume(guildId);
    if (!result?.ok) throw new MusicControlError('nothing_playing', 'There is no paused track to resume.', 404);
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function skipMusic(client, guildId, userId) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    if (!skip(guildId)) throw new MusicControlError('no_active_music', 'There is no active music queue.', 404);
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function stopMusic(client, guildId, userId) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    if (!stop(guildId)) throw new MusicControlError('no_active_music', 'There is no active music queue.', 404);
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function setMusicVolume(client, guildId, userId, volume) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    try {
        setVolume(guildId, volume);
    } catch (error) {
        throw new MusicControlError('invalid_volume', getMusicErrorMessage(error), 400);
    }
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function removeMusicTrack(client, guildId, userId, index) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    try {
        removeQueuedTrack(guildId, index);
    } catch (error) {
        throw new MusicControlError('invalid_queue_index', getMusicErrorMessage(error), 400);
    }
    return serializeMusicSummary(getQueueSummary(guildId));
}

async function moveMusicTrack(client, guildId, userId, from, to) {
    await requireMusicAccess(client, guildId, userId, { requireActive: true });
    try {
        moveQueuedTrack(guildId, from, to);
    } catch (error) {
        throw new MusicControlError('invalid_queue_index', getMusicErrorMessage(error), 400);
    }
    return serializeMusicSummary(getQueueSummary(guildId));
}

module.exports = {
    MusicControlError,
    addTrackFromActivity,
    getMusicState,
    memberCanControlMusic,
    pauseMusic,
    removeMusicTrack,
    requireMusicAccess,
    resumeMusic,
    serializeMusicSummary,
    setMusicVolume,
    skipMusic,
    stopMusic,
    moveMusicTrack,
};
