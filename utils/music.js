const { Readable } = require('node:stream');
const { PermissionFlagsBits } = require('discord.js');
const {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');

const queues = new Map();
const voiceConnectionAttempts = new Map();
const voiceReadyTimeoutMs = 45_000;
const voiceJoinMaxAttempts = 2;

class MusicUserError extends Error {}

function getQueue(guildId) {
    if (!queues.has(guildId)) {
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
        const queue = {
            guildId,
            player,
            connection: null,
            tracks: [],
            current: null,
            textChannel: null,
        };

        player.on(AudioPlayerStatus.Idle, () => {
            queue.current = null;
            playNext(queue).catch(error => {
                console.error('Music playback failed:', error);
                queue.textChannel?.send(`Music playback failed: ${error.message}`).catch(() => null);
            });
        });
        player.on('error', error => {
            console.error('Music player error:', error);
            queue.textChannel?.send(`Music playback failed: ${error.message}`).catch(() => null);
        });

        queues.set(guildId, queue);
    }

    return queues.get(guildId);
}

function isUrl(value) {
    return /^https?:\/\//i.test(value);
}

function createAttachmentTrack(attachment, requestedBy) {
    return {
        title: attachment.name || 'Uploaded audio',
        url: attachment.url,
        source: 'upload',
        requestedBy,
        streamFactory: async () => {
            const response = await fetch(attachment.url);
            if (!response.ok || !response.body) throw new Error(`Could not fetch uploaded file (${response.status}).`);
            return { stream: Readable.fromWeb(response.body), inputType: undefined };
        },
    };
}

async function spotifyToSearch(url) {
    const item = await play.spotify(url);
    if (item.type !== 'track') {
        throw new Error('Spotify playlists and albums are not queued yet. Use a Spotify track link.');
    }

    const artists = Array.isArray(item.artists) ? item.artists.map(artist => artist.name).filter(Boolean).join(' ') : '';
    return `${item.name} ${artists}`.trim();
}

async function resolvePlayableTrack(query, requestedBy) {
    const value = String(query || '').trim();
    if (!value) throw new Error('Provide a URL or search query.');

    let url = value;
    let source = 'url';

    if (isUrl(value) && value.includes('spotify.com')) {
        const searchQuery = await spotifyToSearch(value);
        const results = await play.search(searchQuery, { limit: 1, source: { youtube: 'video' } });
        if (!results.length) throw new Error('No streamable result was found for that Spotify track.');
        url = results[0].url;
        source = 'spotify';
    } else if (!isUrl(value)) {
        const results = await play.search(value, { limit: 1, source: { youtube: 'video' } });
        if (!results.length) throw new Error('No playable result was found.');
        url = results[0].url;
        source = 'search';
    } else {
        const validated = await play.validate(value);
        if (!validated || validated.includes('playlist') || validated.includes('album')) {
            throw new Error('Use a direct track/video URL. Playlists and albums are not queued yet.');
        }
    }

    const info = await play.video_basic_info(url).catch(() => null);
    return {
        title: info?.video_details?.title || value,
        url,
        source,
        requestedBy,
        streamFactory: async () => {
            const stream = await play.stream(url);
            return { stream: stream.stream, inputType: stream.type };
        },
    };
}

function getBotVoicePermissions(voiceChannel, interaction) {
    const botMember = interaction.guild.members.me;
    return botMember ? voiceChannel.permissionsFor(botMember) : null;
}

function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function logVoiceJoinFailure(interaction, voiceChannel, error, attempt) {
    console.warn('Music voice connection attempt failed:', {
        attempt,
        guildId: interaction.guild.id,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        error: error?.message || String(error),
        code: error?.code,
        name: error?.name,
    });
}

function destroyVoiceConnection(connection) {
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;

    try {
        connection.destroy();
    } catch (error) {
        console.warn('Music voice connection cleanup failed:', {
            error: error?.message || String(error),
            code: error?.code,
            name: error?.name,
        });
    }
}

async function joinReadyVoiceChannel(interaction, voiceChannel, attempt = 1) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
    });

    try {
        return await entersState(connection, VoiceConnectionStatus.Ready, voiceReadyTimeoutMs);
    } catch (error) {
        logVoiceJoinFailure(interaction, voiceChannel, error, attempt);
        destroyVoiceConnection(connection);

        if (attempt < voiceJoinMaxAttempts && isAbortError(error)) {
            await wait(1_000);
            return joinReadyVoiceChannel(interaction, voiceChannel, attempt + 1);
        }

        if (isAbortError(error)) {
            throw new MusicUserError('Discord voice timed out while I was joining. I reset the voice connection and retried once; try `/music play` again. If it keeps happening, restart the bot container and check outbound UDP/networking.');
        }

        throw error;
    }
}

async function connectVoiceChannel(interaction, voiceChannel) {
    const guildId = interaction.guild.id;
    const existing = getVoiceConnection(guildId);

    if (existing) {
        if (existing.joinConfig?.channelId && existing.joinConfig.channelId !== voiceChannel.id) {
            destroyVoiceConnection(existing);
        } else {
            if (existing.state.status === VoiceConnectionStatus.Ready) return existing;

            try {
                return await entersState(existing, VoiceConnectionStatus.Ready, voiceReadyTimeoutMs);
            } catch (error) {
                logVoiceJoinFailure(interaction, voiceChannel, error, 'existing');
                destroyVoiceConnection(existing);
            }
        }
    }

    return joinReadyVoiceChannel(interaction, voiceChannel);
}

function getPendingVoiceConnection(guildId, voiceChannel) {
    const pending = voiceConnectionAttempts.get(guildId);
    if (!pending) return null;

    if (pending.channelId !== voiceChannel.id) {
        throw new MusicUserError('I am already joining another voice channel. Try again once that join finishes, or use `/music stop` first.');
    }

    return pending.promise;
}

async function ensureConnection(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) throw new MusicUserError('Join a voice channel first.');

    const permissions = getBotVoicePermissions(voiceChannel, interaction);
    if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
        throw new MusicUserError('I need permission to connect to your voice channel.');
    }
    if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
        throw new MusicUserError('I need permission to speak in your voice channel.');
    }

    const guildId = interaction.guild.id;
    const pending = getPendingVoiceConnection(guildId, voiceChannel);
    if (pending) return pending;

    const promise = connectVoiceChannel(interaction, voiceChannel);
    voiceConnectionAttempts.set(guildId, { channelId: voiceChannel.id, promise });

    try {
        return await promise;
    } finally {
        if (voiceConnectionAttempts.get(guildId)?.promise === promise) {
            voiceConnectionAttempts.delete(guildId);
        }
    }
}

async function playNext(queue) {
    if (queue.current || !queue.tracks.length) return;

    const track = queue.tracks.shift();
    queue.current = track;
    try {
        const source = await track.streamFactory();
        const resource = source.inputType
            ? createAudioResource(source.stream, { inputType: source.inputType })
            : createAudioResource(source.stream);
        queue.player.play(resource);
        queue.textChannel?.send(`Now playing: **${track.title}**`).catch(() => null);
    } catch (error) {
        queue.current = null;
        if (/FFmpeg|avconv/i.test(error?.message || '')) {
            throw new MusicUserError('Music playback needs FFmpeg. Rebuild the Docker image so the new FFmpeg package is installed, then restart the bot.');
        }
        throw error;
    }
}

async function enqueue(interaction, track) {
    const queue = getQueue(interaction.guild.id);
    queue.connection = await ensureConnection(interaction);
    queue.textChannel = interaction.channel;
    queue.connection.subscribe(queue.player);
    queue.tracks.push(track);
    await playNext(queue);
    return queue;
}

function skip(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return false;
    queue.player.stop(true);
    return true;
}

function stop(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return false;
    queue.tracks = [];
    queue.current = null;
    queue.player.stop(true);
    queue.connection?.destroy();
    queues.delete(guildId);
    return true;
}

function getQueueSummary(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return { current: null, tracks: [] };
    return {
        current: queue.current,
        tracks: queue.tracks,
    };
}

function getMusicErrorMessage(error) {
    if (error instanceof MusicUserError) return error.message;
    if (isAbortError(error)) {
        return 'Discord voice timed out while I was joining. Try `/music play` again. If it keeps happening, restart the bot container and check outbound UDP/networking.';
    }
    if (/FFmpeg|avconv/i.test(error?.message || '')) {
        return 'Music playback needs FFmpeg. Rebuild the Docker image so the new FFmpeg package is installed, then restart the bot.';
    }
    return error?.message || 'Music playback failed.';
}

module.exports = {
    createAttachmentTrack,
    enqueue,
    getMusicErrorMessage,
    getQueueSummary,
    resolvePlayableTrack,
    skip,
    stop,
};
