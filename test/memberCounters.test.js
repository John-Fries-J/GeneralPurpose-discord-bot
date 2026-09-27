const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCounterName } = require('../utils/memberCounters');

test('formatCounterName applies custom count format', () => {
    assert.equal(formatCounterName({ type: 'members', nameFormat: 'Members: {count}' }, 42), 'Members: 42');
});

test('formatCounterName falls back by counter type', () => {
    assert.equal(formatCounterName({ type: 'bots' }, 7), 'Bots: 7');
});
