const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ConfigService,
    normalizeLegacyTwitch,
} = require('../utils/config');

function tempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-service-'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

function createService(directory, config, env = {}) {
    const configFile = path.join(directory, 'config.json');
    const exampleConfigFile = path.join(directory, 'exampleconfig.json');
    writeJson(exampleConfigFile, { token: '', database: { provider: 'sqlite', sqlitePath: 'data/default.sqlite' } });
    if (config !== undefined) writeJson(configFile, config);
    return {
        configFile,
        service: new ConfigService({ configFile, exampleConfigFile, env }),
    };
}

test('ConfigService caches runtime config until explicitly refreshed', () => {
    const directory = tempDirectory();
    try {
        const { configFile, service } = createService(directory, { statusName: 'initial' });

        assert.equal(service.getConfig().statusName, 'initial');
        writeJson(configFile, { statusName: 'edited-on-disk' });
        assert.equal(service.getConfig().statusName, 'initial');
        assert.equal(service.refresh().statusName, 'edited-on-disk');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('ConfigService applies environment overrides without writing them to disk', () => {
    const directory = tempDirectory();
    try {
        const { configFile, service } = createService(directory, {
            token: 'file-token',
            database: { provider: 'sqlite', sqlitePath: 'data/file.sqlite' },
        }, {
            DISCORD_TOKEN: 'env-token',
            DATABASE_MYSQL_URL: 'mysql://user:pass@localhost/bot',
        });

        assert.equal(service.getConfig().token, 'env-token');
        assert.equal(service.getConfig().database.mysql.url, 'mysql://user:pass@localhost/bot');
        assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).token, 'file-token');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('legacy uppercase Twitch config is normalized into lowercase twitch', () => {
    const normalized = normalizeLegacyTwitch({
        twitch: { clientSecret: 'current-secret', channels: [] },
        Twitch: {
            ClientId: 'legacy-client',
            AccessToken: 'legacy-token',
            streamerId: 'streamer-id',
            streamerName: 'Streamer',
            discordChannelId: 'discord-channel',
        },
    });

    assert.equal(normalized.twitch.clientId, 'legacy-client');
    assert.equal(normalized.twitch.clientSecret, 'current-secret');
    assert.equal(normalized.twitch.accessToken, 'legacy-token');
    assert.deepEqual(normalized.twitch.channels, [{
        enabled: true,
        streamerId: 'streamer-id',
        streamerName: 'Streamer',
        discordChannelId: 'discord-channel',
        message: '{streamer} is live: {title}\n{url}',
        lastStreamId: '',
    }]);
});

test('saving config atomically removes legacy Twitch while preserving migrated values', () => {
    const directory = tempDirectory();
    try {
        const { configFile, service } = createService(directory, {
            Twitch: {
                ClientId: 'legacy-client',
                AccessToken: 'legacy-token',
            },
        });

        service.saveConfig(service.getStoredConfig());
        const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        assert.equal(saved.Twitch, undefined);
        assert.equal(saved.twitch.clientId, 'legacy-client');
        assert.equal(saved.twitch.accessToken, 'legacy-token');
        assert.equal(fs.readdirSync(directory).filter(file => file.endsWith('.tmp')).length, 0);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
