const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadStoreWithEnvironment(environment) {
    const previous = {};

    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    delete require.cache[require.resolve('../utils/store')];
    const store = require('../utils/store');

    return {
        store,
        restore() {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
            delete require.cache[require.resolve('../utils/store')];
        },
    };
}

test('SQLite storage persists temporary mute records', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
    });

    try {
        await store.upsertTempMute({
            guildId: 'guild',
            userId: 'user',
            removedRoleIds: ['role'],
            expiresAt: Date.now() + 1000,
        });

        assert.deepEqual((await store.getTempMute('guild', 'user')).removedRoleIds, ['role']);
        await store.removeTempMute('guild', 'user');
        assert.equal(await store.getTempMute('guild', 'user'), null);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('JSON storage remains available when configured', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const jsonPath = path.join(directory, 'state.json');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'json',
        DATABASE_JSON_PATH: jsonPath,
    });

    try {
        await store.upsertTempBan({
            guildId: 'guild',
            userId: 'user',
            expiresAt: Date.now() + 1000,
        });

        assert.equal((await store.readState()).tempBans.length, 1);
        assert.equal(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).tempBans[0].userId, 'user');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
