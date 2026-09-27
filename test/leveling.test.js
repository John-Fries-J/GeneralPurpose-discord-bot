const test = require('node:test');
const assert = require('node:assert/strict');
const { allowsTextXp, allowsVoiceXp, getTotalXp } = require('../utils/leveling');

test('level mode helpers respect text, voice, and both modes', () => {
    assert.equal(allowsTextXp({ enabled: true, mode: 'text' }), true);
    assert.equal(allowsVoiceXp({ enabled: true, mode: 'text' }), false);
    assert.equal(allowsTextXp({ enabled: true, mode: 'both' }), true);
    assert.equal(allowsVoiceXp({ enabled: true, mode: 'both' }), true);
    assert.equal(allowsVoiceXp({ enabled: false, mode: 'voice' }), false);
});

test('getTotalXp combines text and voice XP', () => {
    assert.equal(getTotalXp({ textXp: 10, voiceXp: 5 }), 15);
});
