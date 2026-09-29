const test = require('node:test');
const assert = require('node:assert/strict');
const { getMusicSettings } = require('../utils/music');
const { createMusicButtons, createQueuePayload, musicButtonIds } = require('../utils/musicMessages');

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

test('music controls expose queue playback and volume actions', () => {
    const rows = createMusicButtons({ paused: true }).map(row => row.toJSON());
    const ids = rows.flatMap(row => row.components.map(component => component.custom_id));
    const labels = rows.flatMap(row => row.components.map(component => component.label));

    assert.deepEqual(ids, [
        musicButtonIds.queue,
        musicButtonIds.pause,
        musicButtonIds.skip,
        musicButtonIds.stop,
        musicButtonIds.volumeDown,
        musicButtonIds.volumeUp,
    ]);
    assert.ok(labels.includes('Resume'));
});

test('music queue payload shows paused playback state', () => {
    const payload = createQueuePayload({
        current: null,
        tracks: [],
        volume: 80,
        connectionState: 'Ready',
        paused: true,
    });
    const fields = Object.fromEntries(payload.embeds[0].data.fields.map(field => [field.name, field.value]));

    assert.equal(fields.Playback, 'Paused');
    assert.equal(fields.Volume, '80%');
    assert.equal(payload.components.length, 2);
});
