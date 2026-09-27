const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration } = require('../utils/duration');

test('parseDuration accepts supported time units', () => {
    assert.equal(parseDuration('10s'), 10_000);
    assert.equal(parseDuration('5 min'), 5 * 60_000);
    assert.equal(parseDuration('2hours'), 2 * 60 * 60_000);
    assert.equal(parseDuration('3d'), 3 * 24 * 60 * 60_000);
    assert.equal(parseDuration('1w'), 7 * 24 * 60 * 60_000);
});

test('parseDuration rejects invalid durations', () => {
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('0m'), null);
    assert.equal(parseDuration('-1h'), null);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration('10 lightyears'), null);
    assert.equal(parseDuration(null), null);
});
