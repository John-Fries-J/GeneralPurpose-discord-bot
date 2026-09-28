const test = require('node:test');
const assert = require('node:assert/strict');
const { namelessRequest, verifyDiscordLink } = require('../utils/namelessmc');

const settings = {
    enabled: true,
    apiUrl: 'https://example.com/api/v2',
    apiKey: 'secret',
    link: {
        enabled: true,
        integrationName: 'Discord',
    },
};

test('namelessRequest sends bearer auth and JSON payloads', async () => {
    const originalFetch = global.fetch;
    let observed;

    global.fetch = async (url, options) => {
        observed = { url, options };
        return {
            ok: true,
            text: async () => JSON.stringify({ error: false, ok: true }),
        };
    };

    try {
        const result = await namelessRequest('/discord/submit-role-list', {
            method: 'POST',
            body: { roles: [{ id: '1', name: 'Member' }] },
        }, settings);

        assert.equal(result.ok, true);
        assert.equal(observed.url, 'https://example.com/api/v2/discord/submit-role-list');
        assert.equal(observed.options.headers.Authorization, 'Bearer secret');
        assert.equal(observed.options.headers['Content-Type'], 'application/json');
        assert.equal(observed.options.body, JSON.stringify({ roles: [{ id: '1', name: 'Member' }] }));
    } finally {
        global.fetch = originalFetch;
    }
});

test('verifyDiscordLink posts the Discord integration verification payload', async () => {
    const originalFetch = global.fetch;
    let payload;

    global.fetch = async (url, options) => {
        payload = JSON.parse(options.body);
        return {
            ok: true,
            text: async () => JSON.stringify({ error: false }),
        };
    };

    try {
        await verifyDiscordLink({
            id: '123',
            username: 'Marsden',
            discriminator: '0',
        }, 'ABC123', settings);

        assert.deepEqual(payload, {
            integration: 'Discord',
            code: 'ABC123',
            identifier: '123',
            username: 'Marsden',
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('namelessRequest rejects API errors', async () => {
    const originalFetch = global.fetch;

    global.fetch = async () => ({
        ok: true,
        text: async () => JSON.stringify({ error: true, message: 'bad code' }),
    });

    try {
        await assert.rejects(
            () => namelessRequest('integration/verify', {}, settings),
            /bad code/,
        );
    } finally {
        global.fetch = originalFetch;
    }
});
