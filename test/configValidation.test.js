const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../utils/configValidation');

test('validateConfig accepts the example config shape', () => {
    const config = require('../exampleconfig.json');
    assert.deepEqual(validateConfig(config), []);
});

test('validateConfig reports invalid dashboard and database values', () => {
    const errors = validateConfig({
        token: 123,
        dashboard: {
            enabled: 'yes',
            port: 100000,
        },
        database: {
            provider: 'postgres',
        },
    });

    assert(errors.includes('token must be a string.'));
    assert(errors.includes('dashboard.enabled must be a boolean.'));
    assert(errors.includes('dashboard.port must be an integer from 1 to 65535.'));
    assert(errors.includes('database.provider must be either "sqlite" or "json".'));
});
