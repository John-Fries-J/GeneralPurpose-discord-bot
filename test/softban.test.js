const test = require('node:test');
const assert = require('node:assert/strict');
const { softbanUser } = require('../utils/softban');

function createGuild(events, overrides = {}) {
    const user = {
        id: 'user',
        tag: 'User#0001',
        send: async message => {
            events.push(`dm:${message.includes('https://discord.gg/test')}`);
        },
    };
    const channel = {
        createInvite: async () => {
            events.push('invite');
            return { url: 'https://discord.gg/test' };
        },
        permissionsFor: () => ({ has: () => true }),
    };

    return {
        name: 'Test Guild',
        client: {
            users: {
                fetch: async () => user,
            },
        },
        channels: {
            cache: {
                find: callback => (overrides.noInviteChannel ? null : [channel].find(callback)),
            },
        },
        members: {
            me: {},
            fetchMe: async () => ({}),
            ban: async () => events.push('ban'),
            unban: async () => events.push('unban'),
        },
    };
}

test('softbanUser sends invite DM before banning and unbanning', async () => {
    const events = [];
    const result = await softbanUser(createGuild(events), 'user', { reason: 'test' });

    assert.equal(result.dmSent, true);
    assert.deepEqual(events, ['invite', 'dm:true', 'ban', 'unban']);
});

test('softbanUser does not ban when an invite cannot be created', async () => {
    const events = [];

    await assert.rejects(
        () => softbanUser(createGuild(events, { noInviteChannel: true }), 'user', { reason: 'test' }),
        /invite link/,
    );
    assert.deepEqual(events, []);
});
