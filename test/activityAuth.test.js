const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createActivitySession,
    createActivitySessionToken,
    verifyActivitySessionToken,
} = require('../activity/server/auth');
const { consumeRateLimit, __testing: rateLimitTesting } = require('../activity/server/rateLimit');

test('activity session tokens verify and reject tampering', () => {
    const settings = { sessionSecret: 'activity-secret' };
    const session = createActivitySession({ id: '123456789', username: 'mars' });
    const token = createActivitySessionToken(session, settings);

    assert.deepEqual(verifyActivitySessionToken(token, settings), session);
    assert.equal(verifyActivitySessionToken(`${token.slice(0, -2)}xx`, settings), null);
});

test('activity rate limiter returns structured retry timing', () => {
    rateLimitTesting.buckets.clear();
    const first = consumeRateLimit({ key: 'user:rename', limit: 1, windowMs: 60_000 });
    const second = consumeRateLimit({ key: 'user:rename', limit: 1, windowMs: 60_000 });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.retryAfterMs > 0, true);
});
