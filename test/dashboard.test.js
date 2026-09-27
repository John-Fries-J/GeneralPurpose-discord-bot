const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSensitiveConfig, restoreRedactedSecrets } = require('../web/dashboard');

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
