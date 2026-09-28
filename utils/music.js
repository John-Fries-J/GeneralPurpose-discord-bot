const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    generateDependencyReport,
    getVoiceConnection,
    joinVoiceChannel,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');

const queues = new Map();
const voiceConnectionAttempts = new Map();
const observedConnections = new WeakSet();
let dependencyReportLogged = false;
let ytDlpAvailable = null;

class MusicUserError extends Error {}

const DEFAULT_VOICE_READY_TIMEOUT_MS = 60_000;
const DEFAULT_VOICE_JOIN_RETRIES = 1;
const DEFAULT_VOICE_RETRY_DELAY_MS = 1_000;

function getIntegerSetting(value, fallback, min) {
    const number = Number(value ?? fallback);
    return Number.isInteger(number) && number >= min ? number : fallback;
}

function getMusicSettings(config = getConfig()) {
    const readyTimeoutMs = getIntegerSetting(config.music?.voiceReadyTimeoutMs, DEFAULT_VOICE_READY_TIMEOUT_MS, 5_000);
    const maxJoinRetries = getIntegerSetting(config.music?.voiceJoinRetries, DEFAULT_VOICE_JOIN_RETRIES, 0);
    const retryDelayMs = getIntegerSetting(config.music?.voiceRetryDelayMs, DEFAULT_VOICE_RETRY_DELAY_MS, 0);
    const maxQueueLength = getIntegerSetting(config.music?.maxQueueLength, 50, 1);
    const ytDlpCookiesPath = process.env.YTDLP_COOKIES_PATH || config.music?.ytDlpCookiesPath || 'data/youtube-cookies.txt';

    return {
        enabled: config.music?.enabled !== false,
        allowFileUploads: config.music?.allowFileUploads !== false,
        maxQueueLength,
        readyTimeoutMs,
        maxJoinRetries,
        retryDelayMs,
        ytDlpCookiesPath,
    };
}

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
            waitingForReadyPlayback: false,
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

function isYoutubeUrl(value) {
    return /(?:youtube\.com|youtu\.be)/i.test(value);
}

function isSpotifyUrl(value) {
    return /spotify\.com/i.test(value);
}

function formatYtDlpError(error, stderr = '') {
    const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ').trim();
    return detail || error?.message || 'yt-dlp failed.';
}

function getYtDlpCookieStatus(settings = getMusicSettings()) {
    const configuredPath = String(settings.ytDlpCookiesPath || '').trim();
    if (!configuredPath) {
        return {
            configuredPath,
            resolvedPath: '',
            exists: false,
            size: 0,
        };
    }

    const cookiesPath = path.resolve(__dirname, '..', configuredPath);
    const stat = fs.existsSync(cookiesPath) ? fs.statSync(cookiesPath) : null;

    return {
        configuredPath,
        resolvedPath: cookiesPath,
        exists: Boolean(stat?.isFile()),
        size: stat?.isFile() ? stat.size : 0,
    };
}

function getYtDlpCookiesArgs(settings = getMusicSettings()) {
    const status = getYtDlpCookieStatus(settings);
    if (!status.exists) return [];

    return ['--cookies', status.resolvedPath];
}

function isYoutubeBotCheck(error) {
    return /sign in to confirm you.?re not a bot/i.test(error?.message || '');
}

function getYoutubeBotCheckMessage() {
    const status = getYtDlpCookieStatus();
    if (!status.exists) {
        return `YouTube is blocking this server as a bot, and I cannot see a cookie file at ${status.resolvedPath || status.configuredPath || 'the configured cookie path'}. Export YouTube cookies in Netscape format to data/youtube-cookies.txt and rebuild/restart the bot.`;
    }

    return `YouTube is blocking this server as a bot even though I found the cookie file (${status.size} bytes) at ${status.resolvedPath}. Re-export fresh YouTube cookies in Netscape format from a signed-in browser session, then restart the bot.`;
}

function runYtDlp(args, { collectStdout = true } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('yt-dlp', args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';

        child.on('error', error => {
            reject(error);
        });

        if (collectStdout) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => {
                stdout += chunk;
            });
        }

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });

        child.on('close', code => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(formatYtDlpError(new Error(`yt-dlp exited with ${code}`), stderr)));
            }
        });
    });
}

async function hasYtDlp() {
    if (ytDlpAvailable !== null) return ytDlpAvailable;

    try {
        await runYtDlp(['--version']);
        ytDlpAvailable = true;
    } catch {
        ytDlpAvailable = false;
    }

    return ytDlpAvailable;
}

async function getYtDlpInfo(input) {
    if (!await hasYtDlp()) return null;

    const target = isUrl(input) ? input : `ytsearch1:${input}`;
    const cookiesArgs = getYtDlpCookiesArgs();
    try {
        const { stdout } = await runYtDlp([
            ...cookiesArgs,
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            '--default-search',
            'ytsearch',
            target,
        ]);
        const info = JSON.parse(stdout);
        const entry = Array.isArray(info.entries) ? info.entries[0] : info;
        if (!entry?.webpage_url && !entry?.url) return null;
        return entry;
    } catch (error) {
        const cookieStatus = getYtDlpCookieStatus();
        console.warn('[MUSIC] yt-dlp metadata lookup failed:', {
            input,
            error: error.message,
            cookiesPath: cookieStatus.resolvedPath || cookieStatus.configuredPath,
            cookiesFound: cookieStatus.exists,
            cookiesSize: cookieStatus.size,
        });
        if (isYoutubeBotCheck(error)) {
            throw new MusicUserError(getYoutubeBotCheckMessage());
        }
        return null;
    }
}

function createYtDlpStream(url) {
    const cookiesArgs = getYtDlpCookiesArgs();
    const child = spawn('yt-dlp', [
        ...cookiesArgs,
        '--no-playlist',
        '--no-warnings',
        '-f',
        'bestaudio/best',
        '-o',
        '-',
        url,
    ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });

    child.on('error', error => {
        child.stdout.destroy(error);
    });

    child.on('close', code => {
        if (code !== 0) {
            const error = new Error(formatYtDlpError(new Error(`yt-dlp exited with ${code}`), stderr));
            if (isYoutubeBotCheck(error)) {
                child.stdout.destroy(new MusicUserError(getYoutubeBotCheckMessage()));
            } else {
                child.stdout.destroy(error);
            }
        }
    });

    return child.stdout;
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
    let title = value;

    if (isUrl(value) && isSpotifyUrl(value)) {
        const searchQuery = await spotifyToSearch(value);
        const info = await getYtDlpInfo(searchQuery);
        if (info) {
            url = info.webpage_url || info.original_url || info.url;
            title = info.title || searchQuery;
        } else {
            const results = await play.search(searchQuery, { limit: 1, source: { youtube: 'video' } });
            if (!results.length) throw new Error('No streamable result was found for that Spotify track.');
            url = results[0].url;
            title = results[0].title || searchQuery;
        }
        source = 'spotify';
    } else if (!isUrl(value)) {
        const info = await getYtDlpInfo(value);
        if (info) {
            url = info.webpage_url || info.original_url || info.url;
            title = info.title || value;
        } else {
            const results = await play.search(value, { limit: 1, source: { youtube: 'video' } });
            if (!results.length) throw new Error('No playable result was found.');
            url = results[0].url;
            title = results[0].title || value;
        }
        source = 'search';
    } else if (isYoutubeUrl(value) && await hasYtDlp()) {
        const info = await getYtDlpInfo(value);
        if (!info) throw new Error('No playable result was found for that URL.');
        url = info.webpage_url || info.original_url || value;
        title = info.title || value;
    } else {
        const validated = await play.validate(value);
        if (!validated || validated.includes('playlist') || validated.includes('album')) {
            throw new Error('Use a direct track/video URL. Playlists and albums are not queued yet.');
        }
    }

    const info = title === value ? await play.video_basic_info(url).catch(() => null) : null;
    return {
        title: title || info?.video_details?.title || value,
        url,
        source,
        requestedBy,
        streamFactory: async () => {
            if (await hasYtDlp()) {
                return { stream: createYtDlpStream(url), inputType: undefined };
            }

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

function logMusicDependencyReport() {
    if (dependencyReportLogged) return;
    dependencyReportLogged = true;
    console.log(`[MUSIC] Voice dependency report:\n${generateDependencyReport()}`);
}

function describeConnectionState(connection) {
    const state = connection?.state;
    if (!state) return 'unknown';
    const reason = state.reason ? ` reason=${state.reason}` : '';
    const closeCode = state.closeCode ? ` closeCode=${state.closeCode}` : '';
    return `${state.status}${reason}${closeCode}`;
}

function observeConnection(connection, guildId) {
    if (!connection || observedConnections.has(connection)) return;
    observedConnections.add(connection);

    connection.on('stateChange', (oldState, newState) => {
        console.log('[MUSIC] Voice connection state changed:', {
            guildId,
            oldStatus: oldState.status,
            newStatus: newState.status,
            reason: newState.reason,
            closeCode: newState.closeCode,
        });
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

async function joinReadyVoiceChannel(interaction, voiceChannel, attempt = 1, settings = getMusicSettings()) {
    logMusicDependencyReport();

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
    });
    observeConnection(connection, interaction.guild.id);

    try {
        return await entersState(connection, VoiceConnectionStatus.Ready, settings.readyTimeoutMs);
    } catch (error) {
        logVoiceJoinFailure(interaction, voiceChannel, error, attempt);

        if (attempt <= settings.maxJoinRetries && isAbortError(error)) {
            destroyVoiceConnection(connection);
            await wait(settings.retryDelayMs);
            return joinReadyVoiceChannel(interaction, voiceChannel, attempt + 1, settings);
        }

        if (isAbortError(error)) {
            console.warn('[MUSIC] Voice connection did not become ready before timeout; destroying timed-out connection.', {
                guildId: interaction.guild.id,
                channelId: voiceChannel.id,
                state: describeConnectionState(connection),
                timeoutMs: settings.readyTimeoutMs,
            });
            destroyVoiceConnection(connection);
            throw new MusicUserError('Discord voice did not become ready before the join timeout. I reset the connection; try `/music play` again. If this keeps happening, check that the bot container can make outbound UDP/WebSocket connections to Discord voice.');
        }

        destroyVoiceConnection(connection);
        throw error;
    }
}

async function connectVoiceChannel(interaction, voiceChannel) {
    const settings = getMusicSettings();
    const guildId = interaction.guild.id;
    const existing = getVoiceConnection(guildId);
    const queue = queues.get(guildId);

    if (existing) {
        observeConnection(existing, guildId);
        if (existing.joinConfig?.channelId && existing.joinConfig.channelId !== voiceChannel.id) {
            if (queue?.current || queue?.tracks?.length) {
                throw new MusicUserError(`I am already playing in <#${existing.joinConfig.channelId}>. Use \`/music stop\` there before moving me.`);
            }
            destroyVoiceConnection(existing);
        } else {
            if (existing.state.status === VoiceConnectionStatus.Ready) return existing;

            try {
                return await entersState(existing, VoiceConnectionStatus.Ready, settings.readyTimeoutMs);
            } catch (error) {
                logVoiceJoinFailure(interaction, voiceChannel, error, 'existing');
                if (isAbortError(error)) {
                    console.warn('[MUSIC] Existing voice connection is still not ready; destroying timed-out connection.', {
                        guildId,
                        channelId: voiceChannel.id,
                        state: describeConnectionState(existing),
                        timeoutMs: settings.readyTimeoutMs,
                    });
                    destroyVoiceConnection(existing);
                    throw new MusicUserError('Discord voice did not become ready before the join timeout. I reset the connection; try `/music play` again. If this keeps happening, check that the bot container can make outbound UDP/WebSocket connections to Discord voice.');
                }

                destroyVoiceConnection(existing);
            }
        }
    }

    return joinReadyVoiceChannel(interaction, voiceChannel, 1, settings);
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
        if (queue.connection?.state.status !== VoiceConnectionStatus.Ready) {
            console.warn('[MUSIC] Starting audio player before voice connection is ready; audio will begin once Discord voice is ready.', {
                guildId: queue.guildId,
                state: describeConnectionState(queue.connection),
            });
        }
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

function schedulePlaybackWhenReady(queue) {
    if (!queue.connection || queue.waitingForReadyPlayback) return;
    if (queue.connection.state.status === VoiceConnectionStatus.Ready) {
        playNext(queue).catch(error => {
            console.error('Music playback failed:', error);
            queue.textChannel?.send(`Music playback failed: ${error.message}`).catch(() => null);
        });
        return;
    }

    queue.waitingForReadyPlayback = true;
    const connection = queue.connection;
    const startWhenReady = (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Destroyed) {
            queue.waitingForReadyPlayback = false;
            connection.off('stateChange', startWhenReady);
            return;
        }

        if (newState.status !== VoiceConnectionStatus.Ready) return;

        queue.waitingForReadyPlayback = false;
        connection.off('stateChange', startWhenReady);
        playNext(queue).catch(error => {
            console.error('Music playback failed:', error);
            queue.textChannel?.send(`Music playback failed: ${error.message}`).catch(() => null);
        });
    };

    connection.on('stateChange', startWhenReady);
}

async function enqueue(interaction, track) {
    const settings = getMusicSettings();
    if (!settings.enabled) throw new MusicUserError('Music is currently disabled in config.');

    const queue = getQueue(interaction.guild.id);
    const queuedCount = queue.tracks.length + (queue.current ? 1 : 0);
    if (queuedCount >= settings.maxQueueLength) {
        throw new MusicUserError(`The music queue is full (${settings.maxQueueLength} tracks).`);
    }

    queue.connection = await ensureConnection(interaction);
    queue.textChannel = interaction.channel;
    const subscription = queue.connection.subscribe(queue.player);
    if (!subscription) throw new Error('Could not subscribe the audio player to the voice connection.');
    queue.tracks.push(track);
    if (queue.connection.state.status === VoiceConnectionStatus.Ready) {
        await playNext(queue);
    } else {
        schedulePlaybackWhenReady(queue);
    }
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
    const connection = getVoiceConnection(guildId);
    voiceConnectionAttempts.delete(guildId);

    if (!queue && !connection) return false;
    if (queue) {
        queue.tracks = [];
        queue.current = null;
        queue.player.stop(true);
        destroyVoiceConnection(queue.connection);
    }
    destroyVoiceConnection(connection);
    queues.delete(guildId);
    return true;
}

function getQueueSummary(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return { current: null, tracks: [], connectionState: null };
    return {
        current: queue.current,
        tracks: queue.tracks,
        connectionState: describeConnectionState(queue.connection),
        connectionReady: queue.connection?.state.status === VoiceConnectionStatus.Ready,
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
    getYtDlpCookiesArgs,
    getYtDlpCookieStatus,
    describeConnectionState,
    generateDependencyReport,
    resolvePlayableTrack,
    skip,
    stop,
    getMusicSettings,
};
