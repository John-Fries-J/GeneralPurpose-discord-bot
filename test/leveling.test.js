const test = require('node:test');
const assert = require('node:assert/strict');
const { allowsTextXp, allowsVoiceXp, formatProgressBar, getLevelProgress, getTotalXp, getXpForLevel } = require('../utils/leveling');

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

test('level progress uses cumulative XP thresholds', () => {
    const settings = { xpPerLevelBase: 100 };

    assert.equal(getXpForLevel(0, settings), 0);
    assert.equal(getXpForLevel(1, settings), 100);
    assert.equal(getXpForLevel(2, settings), 300);

    assert.deepEqual(getLevelProgress({ textXp: 125, voiceXp: 0 }, settings), {
        level: 1,
        totalXp: 125,
        currentLevelXp: 100,
        nextLevelXp: 300,
        progressXp: 25,
        neededXp: 200,
        percent: 0.125,
    });
});

test('formatProgressBar renders fixed width progress', () => {
    assert.equal(formatProgressBar(0.5, 10), '[#####-----]');
    assert.equal(formatProgressBar(2, 10), '[##########]');
    assert.equal(formatProgressBar(-1, 10), '[----------]');
});
