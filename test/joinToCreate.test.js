const test = require('node:test');
const assert = require('node:assert/strict');
const { formatVoiceChannelName } = require('../utils/joinToCreate');

test('formatVoiceChannelName supports username and display name placeholders', () => {
    const member = {
        displayName: 'Mars',
        user: {
            username: 'marsden',
        },
    };

    assert.equal(formatVoiceChannelName('{displayName} / {username}', member), 'Mars / marsden');
});

test('formatVoiceChannelName supports username aliases', () => {
    const member = {
        id: '123',
        displayName: 'Mars',
        user: {
            globalName: 'Marsden',
            tag: 'marsden#0001',
            username: 'marsden',
        },
    };

    assert.equal(formatVoiceChannelName("{user}'s epic call", member), "marsden's epic call");
    assert.equal(formatVoiceChannelName('{globalName}', member), 'Marsden');
});
