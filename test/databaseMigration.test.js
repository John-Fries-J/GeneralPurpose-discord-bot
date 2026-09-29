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
    const database = require('../database');

    return {
        store,
        database,
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

function representativeLegacyState() {
    return {
        cases: [{
            guildId: 'guild',
            type: 'warn',
            userId: 'user',
            userTag: 'User#0001',
            moderatorId: 'mod',
            moderatorTag: 'Mod#0001',
            reason: 'Legacy warning',
            active: true,
        }],
        modNotes: [{
            id: 'note-1',
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            moderatorId: 'mod',
            moderatorTag: 'Mod#0001',
            note: 'Legacy note',
            createdAt: 10,
        }],
        reminders: [{
            id: 'reminder-1',
            guildId: 'guild',
            channelId: 'channel',
            userId: 'user',
            userTag: 'User#0001',
            message: 'Legacy reminder',
            remindAt: 20,
            status: 'pending',
            createdAt: 1,
        }],
        scheduledMessages: [{
            id: 'scheduled-1',
            guildId: 'guild',
            channelId: 'channel',
            content: 'Legacy schedule',
            scheduledFor: 30,
            status: 'pending',
            createdAt: 1,
        }],
        tempVoiceChannels: [{
            guildId: 'guild',
            channelId: 'voice',
            ownerId: 'user',
            createdAt: 1,
        }],
        ticketRecords: [{
            guildId: 'guild',
            channelId: 'ticket',
            openerId: 'user',
            openerTag: 'User#0001',
            status: 'open',
            priority: 'normal',
            tags: ['legacy'],
            lastActivityAt: 1,
            createdAt: 1,
        }],
        tempMutes: [{
            guildId: 'guild',
            userId: 'user',
            removedRoleIds: ['role'],
            expiresAt: 40,
        }],
    };
}

test('SQLite initialization imports legacy JSON state once and creates a backup', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-migration-json-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const jsonPath = path.join(directory, 'bot-state.json');
    fs.writeFileSync(jsonPath, `${JSON.stringify(representativeLegacyState())}\n`);

    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
        DATABASE_JSON_PATH: jsonPath,
    });

    try {
        await store.initializeStorage();
        await store.initializeStorage();

        const state = await store.readState();
        assert.equal(state.cases.length, 1);
        assert.equal(state.modNotes.length, 1);
        assert.equal(state.reminders.length, 1);
        assert.equal(state.scheduledMessages.length, 1);
        assert.equal(state.tempVoiceChannels.length, 1);
        assert.equal(state.ticketRecords.length, 1);
        assert.deepEqual((await store.getTempMute('guild', 'user')).removedRoleIds, ['role']);
        assert.equal(fs.readdirSync(directory).filter(file => file.includes('bot-state.json.pre-normalized')).length, 1);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('SQLite initialization imports legacy bot_state SQL once and creates a backup', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-migration-sql-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const SQL = await require('sql.js')();
    const legacy = new SQL.Database();
    legacy.run('CREATE TABLE bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    const insert = legacy.prepare('INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)');
    const state = representativeLegacyState();
    for (const [key, value] of Object.entries(state)) {
        insert.run([key, JSON.stringify(value), Date.now()]);
    }
    insert.free();
    fs.writeFileSync(sqlitePath, Buffer.from(legacy.export()));
    legacy.close();

    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        await store.initializeStorage();
        await store.initializeStorage();

        const migrated = await store.readState();
        assert.equal(migrated.cases.length, 1);
        assert.equal(migrated.modNotes.length, 1);
        assert.equal(migrated.reminders.length, 1);
        assert.equal(migrated.ticketRecords.length, 1);
        assert.equal(fs.readdirSync(directory).filter(file => file.includes('state.sqlite.pre-normalized')).length, 1);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('SQLite initialization reports the latest schema migration version', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-migration-version-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const { store, database, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        await store.initializeStorage();
        const initialized = await database.initializeDatabase({ sqlitePath, jsonPath: path.join(directory, 'missing.json') });
        const latest = initialized.db.prepare('SELECT MAX(version) AS version FROM schema_migrations WHERE version < 9000000').get().version;

        assert.equal(initialized.schemaVersion, latest);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
