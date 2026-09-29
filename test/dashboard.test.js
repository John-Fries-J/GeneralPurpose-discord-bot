const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createSessionToken,
    redactSensitiveConfig,
    restoreRedactedSecrets,
    validateConfigSectionEdit,
    verifySessionToken,
} = require('../web/dashboard');

test('redactSensitiveConfig hides dashboard secrets without changing normal fields', () => {
    const redacted = redactSensitiveConfig({
        token: 'bot-token',
        guildId: '123',
        dashboard: {
            oauth: {
                clientSecret: 'oauth-secret',
                clientId: '456',
            },
        },
    });

    assert.equal(redacted.token, '[redacted]');
    assert.equal(redacted.guildId, '123');
    assert.equal(redacted.dashboard.oauth.clientSecret, '[redacted]');
    assert.equal(redacted.dashboard.oauth.clientId, '456');
});

test('restoreRedactedSecrets preserves existing values for redacted placeholders', () => {
    const restored = restoreRedactedSecrets({
        token: '[redacted]',
        dashboard: {
            oauth: {
                clientSecret: '[redacted]',
                redirectUri: 'http://localhost/callback',
            },
        },
    }, {
        token: 'bot-token',
        dashboard: {
            oauth: {
                clientSecret: 'oauth-secret',
                redirectUri: 'old',
            },
        },
    });

    assert.equal(restored.token, 'bot-token');
    assert.equal(restored.dashboard.oauth.clientSecret, 'oauth-secret');
    assert.equal(restored.dashboard.oauth.redirectUri, 'http://localhost/callback');
});

test('dashboard session tokens survive without in-memory state', () => {
    const session = {
        user: { id: '123', username: 'Mars' },
        csrfToken: 'csrf',
        expiresAt: Date.now() + 60_000,
    };

    const token = createSessionToken(session);
    assert.deepEqual(verifySessionToken(token), session);
    assert.equal(verifySessionToken(`${token.slice(0, -2)}xx`), null);
});

test('expired dashboard session tokens are rejected', () => {
    const token = createSessionToken({
        user: { id: '123' },
        csrfToken: 'csrf',
        expiresAt: Date.now() - 1,
    });

    assert.equal(verifySessionToken(token), null);
});

test('advanced config section edits are limited and shape validated', () => {
    assert.doesNotThrow(() => validateConfigSectionEdit('youtube', { apiKey: '', channels: [] }, {}));
    assert.throws(
        () => validateConfigSectionEdit('pollTemplates', {}, {}),
        /pollTemplates must be a JSON array/,
    );
    assert.throws(
        () => validateConfigSectionEdit('dashboard', { enabled: true }, {}),
        /Unsupported config section/,
    );
    assert.throws(
        () => validateConfigSectionEdit('twitch', { channels: {} }, {}),
        /twitch\.channels must be an array/,
    );
});
