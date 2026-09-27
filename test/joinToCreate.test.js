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
