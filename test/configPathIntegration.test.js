const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function tempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-path-integration-'));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

function loadFreshConfigBackupService(configPath) {
    const previousConfigPath = process.env.CONFIG_PATH;
    process.env.CONFIG_PATH = configPath;

    const configModulePath = require.resolve('../utils/config');
    const backupModulePath = require.resolve('../web/services/configBackups');
    delete require.cache[backupModulePath];
    delete require.cache[configModulePath];

    const backups = require('../web/services/configBackups');

    return {
        backups,
        restore() {
            delete require.cache[backupModulePath];
            delete require.cache[configModulePath];
            if (previousConfigPath === undefined) delete process.env.CONFIG_PATH;
            else process.env.CONFIG_PATH = previousConfigPath;
        },
    };
}

test('dashboard config backups read and restore the CONFIG_PATH file', () => {
    const directory = tempDirectory();
    let loaded;

    try {
        const configPath = path.join(directory, 'data', 'config.json');
        const backupDirectory = path.join(directory, 'config-backups');
        writeJson(configPath, {
            token: 'current-token',
            statusName: 'before-restore',
            database: { provider: 'sqlite' },
        });

        loaded = loadFreshConfigBackupService(configPath);
        const { createConfigBackup, restoreConfigBackup } = loaded.backups;

        const created = createConfigBackup('override-path', { directory: backupDirectory });
        const createdBackup = JSON.parse(fs.readFileSync(path.join(backupDirectory, created), 'utf8'));
        assert.equal(createdBackup.statusName, 'before-restore');
        assert.equal(createdBackup.token, '[redacted]');

        const restoreFile = 'config-2026-01-01T00-00-00-000Z-restore.json';
        writeJson(path.join(backupDirectory, restoreFile), {
            token: '[redacted]',
            statusName: 'after-restore',
            database: { provider: 'sqlite' },
        });

        restoreConfigBackup(restoreFile, { directory: backupDirectory });

        const restored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(restored.statusName, 'after-restore');
        assert.equal(restored.token, 'current-token');
    } finally {
        if (loaded) loaded.restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
