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
    assert(errors.includes('database.provider must be "sqlite", "json", or "mysql".'));
});

test('validateConfig accepts mysql when a connection string is configured', () => {
    const errors = validateConfig({
        database: {
            provider: 'mysql',
            mysql: {
                url: 'mysql://user:password@localhost:3306/bot',
            },
        },
    });

    assert.deepEqual(errors, []);
});

test('validateConfig requires mysql url for mysql provider', () => {
    const errors = validateConfig({
        database: {
            provider: 'mysql',
            mysql: {
                url: '',
            },
        },
    });

    assert(errors.includes('database.mysql.url is required.'));
});

test('validateConfig validates retention limits', () => {
    assert.deepEqual(validateConfig({
        retention: {
            commandUsageMaxEntries: 100,
            voiceActivityMaxEntries: 100,
            guildConfigAuditMaxEntries: 100,
        },
    }), []);

    const errors = validateConfig({
        retention: {
            commandUsageMaxEntries: 0,
            voiceActivityMaxEntries: 'many',
        },
    });

    assert(errors.includes('retention.commandUsageMaxEntries must be an integer from 1 to 1000000.'));
    assert(errors.includes('retention.voiceActivityMaxEntries must be an integer from 1 to 1000000.'));
});

test('validateConfig accepts expanded honeypot settings', () => {
    const errors = validateConfig({
        honeypot: {
            enabled: true,
            channelId: 'honeypot',
            alertChannelId: 'alerts',
            mentionId: 'moderators',
            mentionType: 'role',
            actions: {
                limit: true,
                softban: true,
                timeout: true,
                ignore: true,
            },
            timeoutDurationMs: 3600000,
            limitedAccount: {
                enabled: true,
                roleId: 'limited',
                channelId: 'recovery',
                panelMessageId: 'panel',
                restoreButton: true,
                removeExistingRoles: true,
            },
        },
    });

    assert.deepEqual(errors, []);
});

test('validateConfig rejects invalid expanded honeypot settings', () => {
    const errors = validateConfig({
        honeypot: {
            actions: {
                limit: 'yes',
            },
            timeoutDurationMs: 0,
            limitedAccount: {
                enabled: 'yes',
                roleId: 123,
            },
        },
    });

    assert(errors.includes('honeypot.actions.limit must be a boolean.'));
    assert(errors.includes('honeypot.timeoutDurationMs must be an integer from 1000 to 2419200000.'));
    assert(errors.includes('honeypot.limitedAccount.enabled must be a boolean.'));
    assert(errors.includes('honeypot.limitedAccount.roleId must be a string.'));
});
