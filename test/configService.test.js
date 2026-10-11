const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ConfigService,
    defaultConfigPath,
    normalizeLegacyTwitch,
    resolveConfigPath,
} = require('../utils/config');
const { registerConfigRoutes } = require('../web/routes/configRoutes');
const { registerSettingsRoutes } = require('../web/routes/settingsRoutes');
const { buildRestoredConfig } = require('../web/services/configBackups');
const { escapeHtml } = require('../web/views/components/html');

function tempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-service-'));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

function captureRoutes(register, client = {}) {
    const routes = new Map();
    const app = {
        post(route, ...handlers) {
            routes.set(route, handlers);
        },
    };
    register(app, client, {});
    return routes;
}

function runHandlers(handlers, req, res) {
    let index = 0;
    const next = () => {
        const handler = handlers[index];
        index += 1;
        if (handler) handler(req, res, next);
    };
    next();
}

function createDashboardResponse() {
    return {
        redirectedTo: '',
        statusCode: 200,
        body: '',
        redirect(url) {
            this.redirectedTo = url;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}

function dashboardDeps(service, overrides = {}) {
    return {
        appendDashboardLog: () => {},
        assertSafeConfigObject: () => {},
        buildRestoredConfig,
        createConfigBackup: () => 'backup.json',
        editableConfigSectionPages: {},
        escapeHtml,
        getStoredConfig: () => service.getStoredConfig(),
        renderLayout: (title, body) => `${title}${body}`,
        requireCsrf: (req, res, next) => next(),
        restoreConfigBackup: () => {},
        safeErrorMessage: error => error.message,
        saveConfig: config => service.saveConfig(config),
        updateConfig: updater => service.updateConfig(updater),
        validateConfigSectionEdit: () => {},
        ...overrides,
    };
}

test('resolveConfigPath defaults to the repository config path', () => {
    assert.equal(resolveConfigPath({}), path.resolve(defaultConfigPath));
});

test('CONFIG_PATH override is resolved once for a service instance', () => {
    const directory = tempDirectory();
    try {
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        const firstPath = path.join(directory, 'data', 'config.json');
        const secondPath = path.join(directory, 'elsewhere', 'config.json');
        const env = { CONFIG_PATH: firstPath };
        writeJson(exampleConfigFile, { statusName: 'example' });
        writeJson(firstPath, { statusName: 'first' });
        writeJson(secondPath, { statusName: 'second' });

        const service = new ConfigService({ env, exampleConfigFile });
        env.CONFIG_PATH = secondPath;

        assert.equal(service.configPath, path.resolve(firstPath));
        assert.equal(service.refresh().statusName, 'first');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('CONFIG_PATH missing file is initialized from example config without overwriting existing files', () => {
    const directory = tempDirectory();
    try {
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        const configFile = path.join(directory, 'data', 'config.json');
        writeJson(exampleConfigFile, {
            statusName: 'from-example',
            database: { provider: 'sqlite', sqlitePath: 'data/default.sqlite' },
        });

        const service = new ConfigService({
            env: { CONFIG_PATH: configFile },
            exampleConfigFile,
        });

        assert.equal(service.getStoredConfig().statusName, 'from-example');
        assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).statusName, 'from-example');

        writeJson(configFile, { statusName: 'existing' });
        service.invalidate();
        assert.equal(service.getStoredConfig().statusName, 'existing');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('default missing config file still falls back to example without creating a file', () => {
    const directory = tempDirectory();
    try {
        const configFile = path.join(directory, 'config.json');
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        writeJson(exampleConfigFile, { statusName: 'example-default' });

        const service = new ConfigService({ configFile, exampleConfigFile, env: {} });

        assert.equal(service.getStoredConfig().statusName, 'example-default');
        assert.equal(fs.existsSync(configFile), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('ConfigService loads and updates the CONFIG_PATH file', () => {
    const directory = tempDirectory();
    try {
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        const configFile = path.join(directory, 'data', 'config.json');
        const oldDefaultFile = path.join(directory, 'config.json');
        writeJson(exampleConfigFile, { statusName: 'example' });
        writeJson(configFile, { statusName: 'from-override' });
        writeJson(oldDefaultFile, { statusName: 'old-default' });

        const service = new ConfigService({
            env: { CONFIG_PATH: configFile },
            exampleConfigFile,
        });

        assert.equal(service.getConfig().statusName, 'from-override');
        service.updateConfig(config => {
            config.statusName = 'updated';
            return config;
        });

        assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).statusName, 'updated');
        assert.equal(JSON.parse(fs.readFileSync(oldDefaultFile, 'utf8')).statusName, 'old-default');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('atomic save uses a temporary file in the CONFIG_PATH directory before rename', () => {
    const directory = tempDirectory();
    const originalRenameSync = fs.renameSync;
    const renames = [];
    try {
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        const configFile = path.join(directory, 'data', 'config.json');
        writeJson(exampleConfigFile, { statusName: 'example' });
        writeJson(configFile, { statusName: 'initial' });
        const service = new ConfigService({
            env: { CONFIG_PATH: configFile },
            exampleConfigFile,
        });

        fs.renameSync = (source, destination) => {
            renames.push({ source, destination });
            return originalRenameSync(source, destination);
        };

        service.saveConfig({ statusName: 'saved' });

        assert.equal(renames.length, 1);
        assert.equal(renames[0].destination, path.resolve(configFile));
        assert.equal(path.dirname(renames[0].source), path.dirname(path.resolve(configFile)));
        assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).statusName, 'saved');
        assert.deepEqual(fs.readdirSync(path.dirname(configFile)).filter(file => file.endsWith('.tmp')), []);
    } finally {
        fs.renameSync = originalRenameSync;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('dashboard config editors write global config through CONFIG_PATH', () => {
    const directory = tempDirectory();
    try {
        const exampleConfigFile = path.join(directory, 'exampleconfig.json');
        const configFile = path.join(directory, 'data', 'config.json');
        const staleDefaultFile = path.join(directory, 'config.json');
        writeJson(exampleConfigFile, { database: { provider: 'sqlite' } });
        writeJson(configFile, {
            token: 'old-token',
            statusName: 'before',
            database: { provider: 'sqlite' },
            commandSettings: { modules: {} },
        });
        writeJson(staleDefaultFile, { statusName: 'stale' });

        const service = new ConfigService({
            env: { CONFIG_PATH: configFile },
            exampleConfigFile,
        });
        const session = { user: { id: 'admin' } };
        const configRoutes = captureRoutes((app, client) => registerConfigRoutes(app, client, dashboardDeps(service)));
        const configResponse = createDashboardResponse();

        runHandlers(configRoutes.get('/config-json'), {
            body: {
                config: JSON.stringify({
                    token: 'new-token',
                    statusName: 'from-dashboard-editor',
                    database: { provider: 'sqlite' },
                    commandSettings: { modules: {} },
                }),
            },
            dashboardSession: session,
        }, configResponse);

        assert.equal(configResponse.redirectedTo, '/config');
        assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).statusName, 'from-dashboard-editor');

        const settingsRoutes = captureRoutes((app, client) => registerSettingsRoutes(app, client, dashboardDeps(service, {
            groupCommands: () => [['utility', []]],
            slug: value => value,
        })));
        const settingsResponse = createDashboardResponse();

        runHandlers(settingsRoutes.get('/toggle-module'), {
            body: { module: 'utility', enabled: 'on' },
            dashboardSession: session,
        }, settingsResponse);

        const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        assert.equal(settingsResponse.redirectedTo, '/modules#module-utility');
        assert.equal(saved.commandSettings.modules.utility, true);
        assert.equal(JSON.parse(fs.readFileSync(staleDefaultFile, 'utf8')).statusName, 'stale');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

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
