const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../utils/configValidation');

test('activity config validates disabled defaults', () => {
    const errors = validateConfig({
        token: '',
        clientId: '',
        activity: {
            enabled: false,
            publicUrl: '',
            clientId: '',
            voiceControls: true,
            musicControls: true,
        },
    });

    assert.deepEqual(errors, []);
});

test('activity config requires valid public URL when enabled', () => {
    const errors = validateConfig({
        token: '',
        clientId: '123456789',
        activity: {
            enabled: true,
            publicUrl: 'not a url',
            voiceControls: true,
            musicControls: true,
        },
    });

    assert(errors.includes('activity.publicUrl must be a valid URL.'));
});
