const test = require('node:test');
const assert = require('node:assert/strict');
const { isCommandEnabled, isModuleEnabled } = require('../utils/features');

test('isModuleEnabled defaults modules to enabled', () => {
    assert.equal(isModuleEnabled('moderation', {}), true);
});

test('isModuleEnabled respects disabled modules', () => {
    assert.equal(isModuleEnabled('moderation', {
        commandSettings: {
            modules: {
                moderation: false,
            },
        },
    }), false);
});

test('isCommandEnabled respects command and module toggles', () => {
    const command = {
        category: 'utility',
        data: {
            name: 'ping',
        },
    };

    assert.equal(isCommandEnabled(command, {}), true);
    assert.equal(isCommandEnabled(command, {
        commandSettings: {
            commands: {
                ping: false,
            },
        },
    }), false);
    assert.equal(isCommandEnabled(command, {
        commandSettings: {
            modules: {
                utility: false,
            },
        },
    }), false);
});
