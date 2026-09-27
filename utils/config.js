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
