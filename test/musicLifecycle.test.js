const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cancelMusicIdleDisconnect,
    scheduleMusicIdleDisconnect,
} = require('../services/musicLifecycle');

test('music idle disconnect calls stop when no humans remain', async () => {
    const stopped = [];
    const guild = {
        id: 'guild-idle',
        channels: {
            cache: new Map([['voice', { id: 'voice', members: new Map() }]]),
            fetch: async id => guild.channels.cache.get(id) || null,
        },
    };

    scheduleMusicIdleDisconnect(guild, 'voice', 5, guildId => stopped.push(guildId));
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.deepEqual(stopped, ['guild-idle']);
});

test('music idle disconnect is cancelled when a human rejoins', async () => {
    const stopped = [];
    const guild = {
        id: 'guild-cancel',
        channels: {
            cache: new Map([['voice', { id: 'voice', members: new Map([['user', { user: { bot: false } }]]) }]]),
            fetch: async id => guild.channels.cache.get(id) || null,
        },
    };

    scheduleMusicIdleDisconnect(guild, 'voice', 20, guildId => stopped.push(guildId));
    cancelMusicIdleDisconnect(guild.id);
    await new Promise(resolve => setTimeout(resolve, 35));

    assert.deepEqual(stopped, []);
});
