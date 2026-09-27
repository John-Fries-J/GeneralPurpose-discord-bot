const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTranscriptLine } = require('../utils/tickets');

test('formatTranscriptLine includes message metadata, attachments, and embeds', () => {
    const line = formatTranscriptLine({
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        content: 'Hello',
        author: {
            id: '123',
            tag: 'User#0001',
        },
        attachments: new Map([
            ['a', { url: 'https://example.com/a.png' }],
        ]),
        embeds: [{}],
    });

    assert.match(line, /^\[2026-01-02T03:04:05\.000Z\] User#0001 \(123\): Hello/);
    assert.match(line, /Attachments: https:\/\/example\.com\/a\.png/);
    assert.match(line, /Embeds: 1/);
});
