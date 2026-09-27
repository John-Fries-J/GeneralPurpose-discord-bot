const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyYoutubeItem,
    fillTemplate,
    getYoutubeEntriesFromFeed,
    parseIsoDurationSeconds,
} = require('../utils/mediaAnnouncements');

test('fillTemplate replaces known placeholders', () => {
    assert.equal(fillTemplate('{streamer}: {title} {url}', {
        streamer: 'Alice',
        title: 'Live now',
        url: 'https://example.com',
    }), 'Alice: Live now https://example.com');
});

test('classifyYoutubeItem detects stream, short, community, and video', () => {
    assert.equal(classifyYoutubeItem({ activityType: 'bulletin' }), 'community');
    assert.equal(classifyYoutubeItem({ liveStreamingDetails: {} }), 'stream');
    assert.equal(classifyYoutubeItem({ durationSeconds: 59 }), 'short');
    assert.equal(classifyYoutubeItem({ title: 'Regular upload', durationSeconds: 120 }), 'video');
});

test('parseIsoDurationSeconds parses YouTube durations', () => {
    assert.equal(parseIsoDurationSeconds('PT1H2M3S'), 3723);
    assert.equal(parseIsoDurationSeconds('PT45S'), 45);
});

test('getYoutubeEntriesFromFeed parses RSS entries', () => {
    const entries = getYoutubeEntriesFromFeed(`
        <feed>
            <entry>
                <yt:videoId>abc123</yt:videoId>
                <title>New &amp; Good</title>
                <published>2026-01-01T00:00:00+00:00</published>
            </entry>
        </feed>
    `);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'abc123');
    assert.equal(entries[0].title, 'New & Good');
});
