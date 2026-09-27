const { Readable } = require('node:stream');
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
            const stream = await play.stream(url, { discordPlayerCompatibility: true });
            return { stream: stream.stream, inputType: stream.type };
        },
    };
}

async function ensureConnection(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) throw new Error('Join a voice channel first.');

    const existing = getVoiceConnection(interaction.guild.id);
    if (existing) return existing;

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    return connection;
}

async function playNext(queue) {
    if (queue.current || !queue.tracks.length) return;

    const track = queue.tracks.shift();
    queue.current = track;
    const source = await track.streamFactory();
    const resource = source.inputType
        ? createAudioResource(source.stream, { inputType: source.inputType })
        : createAudioResource(source.stream);
    queue.player.play(resource);
    queue.textChannel?.send(`Now playing: **${track.title}**`).catch(() => null);
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

module.exports = {
    createAttachmentTrack,
    enqueue,
    getQueueSummary,
    resolvePlayableTrack,
    skip,
    stop,
};
