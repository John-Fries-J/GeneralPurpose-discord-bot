const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadStoreWithEnvironment(environment) {
    const previous = {};
    const database = require('../database');

    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    delete require.cache[require.resolve('../utils/store')];
    const store = require('../utils/store');

    return {
        store,
        restore() {
            database.closeDatabase();
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

test('SQLite storage lists expired temporary punishments through due-time queries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
    });
    const now = Date.now();

    try {
        await store.upsertTempBan({ guildId: 'guild', userId: 'expired-ban', expiresAt: now - 1 });
        await store.upsertTempBan({ guildId: 'guild', userId: 'future-ban', expiresAt: now + 60_000 });
        await store.upsertTempMute({ guildId: 'guild', userId: 'expired-mute', removedRoleIds: ['role'], expiresAt: now - 1 });
        await store.upsertTempMute({ guildId: 'guild', userId: 'future-mute', removedRoleIds: [], expiresAt: now + 60_000 });

        assert.deepEqual((await store.listExpiredTempBans(now)).map(record => record.userId), ['expired-ban']);
        assert.deepEqual((await store.listExpiredTempMutes(now)).map(record => record.userId), ['expired-mute']);
        assert.deepEqual((await store.listExpiredTempMutes(now))[0].removedRoleIds, ['role']);
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

test('moderation case helpers create, edit, list, and clear warnings', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const sqlitePath = path.join(directory, 'cases.sqlite');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
    });

    try {
        const warning = await store.createModerationCase({
            guildId: 'guild',
            type: 'warn',
            userId: 'user',
            userTag: 'User#0001',
            moderatorId: 'mod',
            moderatorTag: 'Mod#0001',
            reason: 'Initial reason',
        });

        assert.equal(warning.id, 1);
        assert.equal((await store.getModerationCase('guild', 1)).reason, 'Initial reason');

        const updated = await store.updateModerationCaseReason('guild', 1, 'Updated reason');
        assert.equal(updated.reason, 'Updated reason');
        assert.equal((await store.listModerationCases('guild', { userId: 'user' })).length, 1);

        const cleared = await store.clearWarningCases('guild', 'user', 'mod', 'Resolved');
        assert.equal(cleared, 1);
        assert.equal((await store.getModerationCase('guild', 1)).active, false);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('user history helpers keep recent user events', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const sqlitePath = path.join(directory, 'history.sqlite');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
    });

    try {
        await store.addUserHistory({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            type: 'message',
            summary: 'hello',
            channelId: 'channel',
            createdAt: 1,
        });
        await store.addUserHistory({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            type: 'moderation:warn',
            summary: 'warned',
            createdAt: 2,
        });
        await store.addUserHistory({
            guildId: 'other-guild',
            userId: 'user',
            type: 'message',
            summary: 'elsewhere',
            createdAt: 3,
        });

        const history = await store.listUserHistory('guild', 'user');
        assert.equal(history.length, 2);
        assert.equal(history[0].summary, 'warned');

        const guildHistory = await store.listGuildHistory('guild', 1);
        assert.equal(guildHistory.length, 1);
        assert.equal(guildHistory[0].summary, 'warned');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('state updates serialize concurrent writes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
    const jsonPath = path.join(directory, 'state.json');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'json',
        DATABASE_JSON_PATH: jsonPath,
    });

    try {
        await Promise.all(Array.from({ length: 10 }, (_, index) => store.addUserHistory({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            type: 'message',
            summary: `message ${index}`,
            createdAt: index,
        })));

        assert.equal((await store.listUserHistory('guild', 'user', 20)).length, 10);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
