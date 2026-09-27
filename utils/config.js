const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'config.json');
const exampleConfigPath = path.join(__dirname, '..', 'exampleconfig.json');

function readJson(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getConfig() {
    const config = readJson(configPath, readJson(exampleConfigPath));

    if (process.env.DISCORD_TOKEN) config.token = process.env.DISCORD_TOKEN;
    if (process.env.DISCORD_CLIENT_ID) config.clientId = process.env.DISCORD_CLIENT_ID;
    if (process.env.DISCORD_GUILD_ID) config.guildId = process.env.DISCORD_GUILD_ID;
    if (process.env.DISCORD_STATUS) config.statusName = process.env.DISCORD_STATUS;
    if (process.env.DASHBOARD_ENABLED) {
        config.dashboard = config.dashboard || {};
        config.dashboard.enabled = process.env.DASHBOARD_ENABLED === 'true';
    }
    if (process.env.DASHBOARD_PORT) {
        config.dashboard = config.dashboard || {};
        config.dashboard.port = Number(process.env.DASHBOARD_PORT);
    }
    if (process.env.DASHBOARD_PUBLIC_URL) {
        config.dashboard = config.dashboard || {};
        config.dashboard.publicUrl = process.env.DASHBOARD_PUBLIC_URL;
    }
    if (process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_OAUTH_CLIENT_SECRET || process.env.DISCORD_OAUTH_REDIRECT_URI) {
        config.dashboard = config.dashboard || {};
        config.dashboard.oauth = config.dashboard.oauth || {};
        if (process.env.DISCORD_OAUTH_CLIENT_ID) config.dashboard.oauth.clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
        if (process.env.DISCORD_OAUTH_CLIENT_SECRET) config.dashboard.oauth.clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
        if (process.env.DISCORD_OAUTH_REDIRECT_URI) config.dashboard.oauth.redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
    }
    if (process.env.DATABASE_PROVIDER) {
        config.database = config.database || {};
        config.database.provider = process.env.DATABASE_PROVIDER;
    }
    if (process.env.DATABASE_JSON_PATH) {
        config.database = config.database || {};
        config.database.jsonPath = process.env.DATABASE_JSON_PATH;
    }

    return config;
}

function saveConfig(config) {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`);
}

function updateConfig(updater) {
    const config = readJson(configPath, readJson(exampleConfigPath));
    const nextConfig = updater(config) || config;
    saveConfig(nextConfig);
    return nextConfig;
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
    configPath,
    getConfig,
    saveConfig,
    updateConfig,
    getNestedValue,
};
