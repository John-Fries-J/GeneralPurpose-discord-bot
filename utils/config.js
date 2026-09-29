const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'config.json');
const exampleConfigPath = path.join(__dirname, '..', 'exampleconfig.json');

const environmentConfigKeys = [
    'DASHBOARD_ENABLED',
    'DASHBOARD_HOST',
    'DASHBOARD_PORT',
    'DASHBOARD_PUBLIC_URL',
    'DASHBOARD_SESSION_SECRET',
    'DATABASE_JSON_PATH',
    'DATABASE_MYSQL_URL',
    'DATABASE_PROVIDER',
    'DATABASE_SQLITE_PATH',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'DISCORD_OAUTH_CLIENT_ID',
    'DISCORD_OAUTH_CLIENT_SECRET',
    'DISCORD_OAUTH_REDIRECT_URI',
    'DISCORD_STATUS',
    'DISCORD_TOKEN',
];

function readJson(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function setIfMissing(target, key, value) {
    if (target[key] === undefined || target[key] === null || target[key] === '') {
        target[key] = value ?? '';
    }
}

function normalizeLegacyTwitch(config) {
    if (!isPlainObject(config)) return config;
    if (!isPlainObject(config.Twitch)) return config;

    const legacy = config.Twitch;
    const next = { ...config, twitch: { ...(config.twitch || {}) } };
    setIfMissing(next.twitch, 'clientId', legacy.ClientId);
    setIfMissing(next.twitch, 'accessToken', legacy.AccessToken);
    setIfMissing(next.twitch, 'accessTokenExpiresAt', 0);
    next.twitch.channels = Array.isArray(next.twitch.channels) ? next.twitch.channels : [];

    if (legacy.streamerId && legacy.discordChannelId) {
        const migratedTarget = {
            enabled: true,
            streamerId: legacy.streamerId || '',
            streamerName: legacy.streamerName || legacy.streamerId || '',
            discordChannelId: legacy.discordChannelId || '',
            message: '{streamer} is live: {title}\n{url}',
            lastStreamId: '',
        };
        const duplicate = next.twitch.channels.some(target => (
            target.streamerId === migratedTarget.streamerId
            && target.discordChannelId === migratedTarget.discordChannelId
        ));
        if (!duplicate) {
            next.twitch.channels.push(migratedTarget);
        }
    }

    return next;
}

function prepareConfigForRuntime(config) {
    const prepared = normalizeLegacyTwitch(clone(config || {}));
    if (!isPlainObject(prepared.twitch)) {
        prepared.twitch = {
            clientId: '',
            clientSecret: '',
            accessToken: '',
            accessTokenExpiresAt: 0,
            channels: [],
        };
    }
    return prepared;
}

function prepareConfigForSave(config) {
    const prepared = prepareConfigForRuntime(config);
    delete prepared.Twitch;
    return prepared;
}

function applyEnvironmentOverrides(config, env = process.env) {
    if (env.DISCORD_TOKEN) config.token = env.DISCORD_TOKEN;
    if (env.DISCORD_CLIENT_ID) config.clientId = env.DISCORD_CLIENT_ID;
    if (env.DISCORD_GUILD_ID) config.guildId = env.DISCORD_GUILD_ID;
    if (env.DISCORD_STATUS) config.statusName = env.DISCORD_STATUS;
    if (env.DASHBOARD_ENABLED) {
        config.dashboard = config.dashboard || {};
        config.dashboard.enabled = env.DASHBOARD_ENABLED === 'true';
    }
    if (env.DASHBOARD_HOST) {
        config.dashboard = config.dashboard || {};
        config.dashboard.host = env.DASHBOARD_HOST;
    }
    if (env.DASHBOARD_PORT) {
        config.dashboard = config.dashboard || {};
        config.dashboard.port = Number(env.DASHBOARD_PORT);
    }
    if (env.DASHBOARD_PUBLIC_URL) {
        config.dashboard = config.dashboard || {};
        config.dashboard.publicUrl = env.DASHBOARD_PUBLIC_URL;
    }
    if (env.DASHBOARD_SESSION_SECRET) {
        config.dashboard = config.dashboard || {};
        config.dashboard.sessionSecret = env.DASHBOARD_SESSION_SECRET;
    }
    if (env.DISCORD_OAUTH_CLIENT_ID || env.DISCORD_OAUTH_CLIENT_SECRET || env.DISCORD_OAUTH_REDIRECT_URI) {
        config.dashboard = config.dashboard || {};
        config.dashboard.oauth = config.dashboard.oauth || {};
        if (env.DISCORD_OAUTH_CLIENT_ID) config.dashboard.oauth.clientId = env.DISCORD_OAUTH_CLIENT_ID;
        if (env.DISCORD_OAUTH_CLIENT_SECRET) config.dashboard.oauth.clientSecret = env.DISCORD_OAUTH_CLIENT_SECRET;
        if (env.DISCORD_OAUTH_REDIRECT_URI) config.dashboard.oauth.redirectUri = env.DISCORD_OAUTH_REDIRECT_URI;
    }
    if (env.DATABASE_PROVIDER) {
        config.database = config.database || {};
        config.database.provider = env.DATABASE_PROVIDER;
    }
    if (env.DATABASE_JSON_PATH) {
        config.database = config.database || {};
        config.database.jsonPath = env.DATABASE_JSON_PATH;
    }
    if (env.DATABASE_SQLITE_PATH) {
        config.database = config.database || {};
        config.database.sqlitePath = env.DATABASE_SQLITE_PATH;
    }
    if (env.DATABASE_MYSQL_URL) {
        config.database = config.database || {};
        config.database.mysql = config.database.mysql || {};
        config.database.mysql.url = env.DATABASE_MYSQL_URL;
    }
    return config;
}

function environmentSignature(env = process.env) {
    return JSON.stringify(Object.fromEntries(environmentConfigKeys.map(key => [key, env[key] || ''])));
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 4)}\n`);
    fs.renameSync(temporaryPath, filePath);
}

class ConfigService {
    constructor({
        configFile = configPath,
        exampleConfigFile = exampleConfigPath,
        env = process.env,
    } = {}) {
        this.configPath = configFile;
        this.exampleConfigPath = exampleConfigFile;
        this.env = env;
        this.snapshot = null;
        this.storedSnapshot = null;
        this.envSignature = '';
    }

    loadStoredConfig() {
        const fallback = readJson(this.exampleConfigPath);
        return prepareConfigForRuntime(readJson(this.configPath, fallback));
    }

    refresh() {
        this.storedSnapshot = this.loadStoredConfig();
        this.envSignature = environmentSignature(this.env);
        this.snapshot = applyEnvironmentOverrides(clone(this.storedSnapshot), this.env);
        return this.getConfig();
    }

    invalidate() {
        this.snapshot = null;
        this.storedSnapshot = null;
        this.envSignature = '';
    }

    getStoredConfig() {
        if (!this.storedSnapshot) this.refresh();
        return clone(this.storedSnapshot);
    }

    getConfig() {
        if (!this.storedSnapshot) this.refresh();
        const currentEnvSignature = environmentSignature(this.env);
        if (!this.snapshot || this.envSignature !== currentEnvSignature) {
            this.envSignature = currentEnvSignature;
            this.snapshot = applyEnvironmentOverrides(clone(this.storedSnapshot), this.env);
        }
        return clone(this.snapshot);
    }

    saveConfig(config) {
        const prepared = prepareConfigForSave(config);
        writeJsonAtomic(this.configPath, prepared);
        this.storedSnapshot = prepared;
        this.envSignature = environmentSignature(this.env);
        this.snapshot = applyEnvironmentOverrides(clone(prepared), this.env);
        return this.getStoredConfig();
    }

    updateConfig(updater) {
        const config = this.getStoredConfig();
        const nextConfig = updater(config) || config;
        return this.saveConfig(nextConfig);
    }
}

const defaultConfigService = new ConfigService();

function getConfig() {
    return defaultConfigService.getConfig();
}

function getStoredConfig() {
    return defaultConfigService.getStoredConfig();
}

function saveConfig(config) {
    return defaultConfigService.saveConfig(config);
}

function updateConfig(updater) {
    return defaultConfigService.updateConfig(updater);
}

function getNestedValue(source, pathParts, fallback = undefined) {
    let current = source;

    for (const part of pathParts) {
        if (!current || typeof current !== 'object' || !(part in current)) {
            return fallback;
        }

        current = current[part];
    }

    return current ?? fallback;
}

module.exports = {
    ConfigService,
    applyEnvironmentOverrides,
    configPath,
    getConfig,
    getStoredConfig,
    normalizeLegacyTwitch,
    prepareConfigForRuntime,
    refreshConfig: () => defaultConfigService.refresh(),
    saveConfig,
    updateConfig,
    getNestedValue,
};
