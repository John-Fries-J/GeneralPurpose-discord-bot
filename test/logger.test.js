const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, redact, serializeError } = require('../utils/logger');

test('logger redacts sensitive fields in structured output', () => {
    const lines = [];
    const logger = createLogger({ component: 'test' }, {
        level: 'debug',
        sink: {
            log: line => lines.push(line),
            warn: line => lines.push(line),
            error: line => lines.push(line),
            debug: line => lines.push(line),
        },
    });

    logger.info('login', {
        guildId: 'guild',
        token: 'secret-token',
        nested: { clientSecret: 'secret-client' },
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.message, 'login');
    assert.equal(payload.component, 'test');
    assert.equal(payload.guildId, 'guild');
    assert.equal(payload.token, '[redacted]');
    assert.equal(payload.nested.clientSecret, '[redacted]');
});

test('redact serializes errors and circular references safely', () => {
    const error = new Error('failed');
    const value = { error };
    value.self = value;

    const redacted = redact(value);

    assert.deepEqual(redacted.error, serializeError(error));
    assert.equal(redacted.self, '[Circular]');
});
