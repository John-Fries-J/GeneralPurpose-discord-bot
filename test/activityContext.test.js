const test = require('node:test');
const assert = require('node:assert/strict');
const { readActivityContext, verifyActivityContext } = require('../activity/server/activityService');
const { requireActivityAuth } = require('../activity/server/auth');

function mockRequest({ headers = {}, query = {}, body = {}, cookie = '' } = {}) {
    return {
        headers: { cookie },
        query,
        body,
        path: '/api/activity/test',
        get(name) {
            return headers[name.toLowerCase()] || headers[name] || '';
        },
    };
}

function mockResponse() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
    };
}

test('activity context rejects malformed browser-supplied IDs', () => {
    assert.throws(
        () => readActivityContext(mockRequest({ headers: { 'x-activity-guild-id': 'not-a-snowflake' } })),
        /guildId is invalid/,
    );
});

test('activity auth middleware rejects missing session', () => {
    const req = mockRequest();
    const res = mockResponse();
    let nextCalled = false;

    process.env.DISCORD_ACTIVITY_ENABLED = 'true';
    try {
        requireActivityAuth(req, res, () => {
            nextCalled = true;
        });
    } finally {
        delete process.env.DISCORD_ACTIVITY_ENABLED;
    }

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error.code, 'unauthenticated');
});

test('activity context verification rejects spoofed guild membership', async () => {
    const guild = {
        id: '999999999999',
        members: {
            cache: new Map(),
            fetch: async () => null,
        },
    };
    const client = {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async id => client.guilds.cache.get(id) || null,
        },
    };

    await assert.rejects(
        verifyActivityContext(client, { user: { id: '111111111111' } }, { guildId: guild.id }),
        /not a member/,
    );
});
