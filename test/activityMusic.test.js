const test = require('node:test');
const assert = require('node:assert/strict');
const { getMusicState, removeMusicTrack, moveMusicTrack, setMusicVolume, skipMusic } = require('../services/musicControlService');
const { __testing: musicTesting } = require('../utils/music');

function makeMusicClient(userVoiceChannelId = '444444444444') {
    const member = {
        id: '111111111111',
        displayName: 'Listener',
        user: { id: '111111111111', username: 'listener', bot: false },
        voice: { channelId: userVoiceChannelId, channel: userVoiceChannelId ? { id: userVoiceChannelId } : null },
        permissions: { has: () => false },
    };
    const guild = {
        id: '999999999999',
        name: 'Guild',
        members: {
            cache: new Map([[member.id, member]]),
            fetch: async id => guild.members.cache.get(id) || null,
        },
    };
    const client = {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async id => client.guilds.cache.get(id) || null,
        },
    };
    return { client, guild, member };
}

function putQueue(guildId, voiceChannelId = '444444444444') {
    const queue = {
        guildId,
        current: { title: 'Now', url: 'https://example.test/now', requestedBy: '111111111111', durationMs: 120000 },
        tracks: [
            { title: 'One', url: 'https://example.test/1', requestedBy: '111111111111', durationMs: 60000 },
            { title: 'Two', url: 'https://example.test/2', requestedBy: '111111111111', durationMs: 90000 },
        ],
        volume: 100,
        connection: {
            joinConfig: { channelId: voiceChannelId },
            state: { status: 'ready' },
            destroy: () => {
                queue.connection.state.status = 'destroyed';
            },
        },
        player: {
            state: { status: 'playing' },
            stop: () => {
                queue.stopped = true;
                return true;
            },
            pause: () => {
                queue.player.state.status = 'paused';
                return true;
            },
            unpause: () => {
                queue.player.state.status = 'playing';
                return true;
            },
        },
        currentResource: {
            volume: {
                setVolume: value => {
                    queue.lastVolume = value;
                },
            },
        },
        startedAt: Date.now() - 5_000,
        pausedAt: null,
        pausedAccumulatedMs: 0,
    };
    musicTesting.queues.set(guildId, queue);
    return queue;
}

test.afterEach(() => {
    musicTesting.queues.clear();
});

test('activity music state allows playback voice participant to view queue', async () => {
    const { client, guild, member } = makeMusicClient();
    putQueue(guild.id);

    const state = await getMusicState(client, guild.id, member.id);

    assert.equal(state.authorized, true);
    assert.equal(state.music.current.title, 'Now');
    assert.equal(state.music.queue.length, 2);
});

test('activity music controls deny unrelated voice member', async () => {
    const { client, guild, member } = makeMusicClient('555555555555');
    putQueue(guild.id);

    await assert.rejects(
        skipMusic(client, guild.id, member.id),
        /Join the active playback voice channel/,
    );
});

test('activity music volume validation and queue edits are authoritative', async () => {
    const { client, guild, member } = makeMusicClient();
    const queue = putQueue(guild.id);

    await assert.rejects(setMusicVolume(client, guild.id, member.id, 250), /Volume must be an integer/);
    const volume = await setMusicVolume(client, guild.id, member.id, 80);
    assert.equal(volume.volume, 80);
    assert.equal(queue.lastVolume, 0.8);

    const moved = await moveMusicTrack(client, guild.id, member.id, 1, 0);
    assert.equal(moved.queue[0].title, 'Two');

    const removed = await removeMusicTrack(client, guild.id, member.id, 0);
    assert.equal(removed.queue[0].title, 'One');
    await assert.rejects(removeMusicTrack(client, guild.id, member.id, 10), /Queue position is no longer available/);
});
