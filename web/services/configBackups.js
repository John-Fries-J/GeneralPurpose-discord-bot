const fs = require('node:fs');
const path = require('node:path');
const { getStoredConfig, saveConfig } = require('../../utils/config');
const { validateConfig } = require('../../utils/configValidation');
const {
    assertSafeConfigObject,
    redactSensitiveConfig,
    restoreProtectedConfig,
} = require('../../utils/redaction');

function getConfigBackupDirectory(options = {}) {
    return path.resolve(options.directory || path.join(__dirname, '..', '..', 'data', 'config-backups'));
}

function listConfigBackups(options = {}) {
    const directory = getConfigBackupDirectory(options);
    if (!fs.existsSync(directory)) return [];

    return fs.readdirSync(directory)
        .filter(file => /^config-\d{4}-\d{2}-\d{2}T/.test(file) && file.endsWith('.json'))
        .map(file => {
            const fullPath = path.join(directory, file);
            return { file, fullPath, createdAt: fs.statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

function createConfigBackup(label = 'manual', options = {}) {
    const directory = getConfigBackupDirectory(options);
    fs.mkdirSync(directory, { recursive: true });
    const safeLabel = String(label || 'manual').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'manual';
    const file = `config-${new Date().toISOString().replace(/[:.]/g, '-')}-${safeLabel}.json`;
    const fullPath = path.join(directory, file);
    fs.writeFileSync(fullPath, `${JSON.stringify(redactSensitiveConfig(options.config || getStoredConfig()), null, 4)}\n`);
    return file;
}

function buildRestoredConfig(parsed, currentConfig = getStoredConfig()) {
    assertSafeConfigObject(parsed);
    const restored = restoreProtectedConfig(parsed, currentConfig);
    const errors = validateConfig(restored);
    if (errors.length) throw new Error(errors.join('\n'));
    return restored;
}

function parseBackupJson(source) {
    try {
        return JSON.parse(source);
    } catch {
        throw new Error('Backup JSON is malformed.');
    }
}

function restoreConfigBackup(file, options = {}) {
    const backup = listConfigBackups(options).find(item => item.file === file);
    if (!backup) throw new Error('Backup was not found.');

    const parsed = parseBackupJson(fs.readFileSync(backup.fullPath, 'utf8'));
    const restored = buildRestoredConfig(parsed, options.currentConfig || getStoredConfig());
    const save = options.save || saveConfig;
    save(restored);
}

module.exports = {
    buildRestoredConfig,
    createConfigBackup,
    getConfigBackupDirectory,
    listConfigBackups,
    restoreConfigBackup,
};
