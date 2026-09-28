const test = require('node:test');
const assert = require('node:assert/strict');
const { getMusicSettings } = require('../utils/music');

test('getMusicSettings uses a retry by default for transient voice joins', () => {
    const settings = getMusicSettings({ music: {} });

    assert.equal(settings.maxJoinRetries, 1);
});

test('getMusicSettings preserves explicit zero voice join retries', () => {
    const settings = getMusicSettings({ music: { voiceJoinRetries: 0 } });

    assert.equal(settings.maxJoinRetries, 0);
});

test('getMusicSettings falls back for invalid voice join settings', () => {
    const settings = getMusicSettings({
        music: {
            maxQueueLength: 0,
            voiceReadyTimeoutMs: 1000,
            voiceJoinRetries: -1,
            voiceRetryDelayMs: -1,
        },
    });

    assert.equal(settings.maxQueueLength, 50);
    assert.equal(settings.readyTimeoutMs, 60000);
    assert.equal(settings.maxJoinRetries, 1);
    assert.equal(settings.retryDelayMs, 1000);
});

test('getMusicSettings supports voice debug config', () => {
    assert.equal(getMusicSettings({ music: { voiceDebug: true } }).voiceDebug, true);
    assert.equal(getMusicSettings({ music: { voiceDebug: false } }).voiceDebug, false);
});
