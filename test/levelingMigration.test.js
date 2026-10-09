const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function purgeRuntimeModules() {
    for (const modulePath of [
        '../database',
        '../utils/store',
        '../utils/guildConfig',
        '../utils/leveling',
        '../utils/levelingImport',
        '../utils/levelingTests',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

async function withIsolatedStore(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-leveling-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const jsonPath = path.join(directory, 'state.json');
    const previous = {
        DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
        DATABASE_SQLITE_PATH: process.env.DATABASE_SQLITE_PATH,
        DATABASE_JSON_PATH: process.env.DATABASE_JSON_PATH,
    };
    process.env.DATABASE_PROVIDER = 'sqlite';
    process.env.DATABASE_SQLITE_PATH = sqlitePath;
    process.env.DATABASE_JSON_PATH = jsonPath;
    purgeRuntimeModules();

    const database = require('../database');
    const store = require('../utils/store');

    try {
        await store.initializeStorage();
        return await callback({ database, store, sqlitePath, jsonPath });
    } finally {
        database.closeDatabase();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        purgeRuntimeModules();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function fakeMember(guildId = 'guild', userId = 'user') {
    const roleCache = new Map();
    return {
        id: userId,
        user: { id: userId, tag: 'User#0001', username: 'User', bot: false },
        guild: {
            id: guildId,
            roles: { cache: new Map() },
            members: { me: { permissions: { has: () => true }, roles: { highest: { position: 100 } } } },
        },
        roles: {
            cache: roleCache,
            add: async roleId => roleCache.set(roleId, { id: roleId }),
            remove: async roleId => roleCache.delete(roleId),
        },
    };
}

test('leveling migration creates persistent import and test tables', async () => {
    await withIsolatedStore(async ({ database, sqlitePath, jsonPath }) => {
        const { db } = await database.initializeDatabase({ sqlitePath, jsonPath });
        for (const table of [
            'level_xp_events',
            'level_import_jobs',
            'level_import_checkpoints',
            'level_import_messages',
            'level_import_processed_messages',
            'level_role_level_mappings',
            'level_reconciliation_records',
            'level_test_sessions',
        ]) {
            assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `${table} should exist`);
        }
    });
});

test('duplicate historical import messages are ignored by job and profile', async () => {
    await withIsolatedStore(async ({ store }) => {
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            profileHash: 'profile',
            profile: { textXpMin: 1, textXpMax: 1 },
        });

        assert.equal(created.ok, true);
        assert.equal(await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            channelId: 'channel',
            createdAt: 1,
            xpAmount: 1,
        }), true);
        assert.equal(await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            channelId: 'channel',
            createdAt: 1,
            xpAmount: 1,
        }), false);

        assert.equal(await store.markLevelImportMessageProcessed({
            guildId: 'guild',
            messageId: 'message',
            profileHash: 'profile',
            jobId: created.job.id,
            userId: 'user',
            channelId: 'channel',
            xpAmount: 1,
        }), true);
        assert.equal(await store.markLevelImportMessageProcessed({
            guildId: 'guild',
            messageId: 'message',
            profileHash: 'profile',
            jobId: created.job.id,
            userId: 'user',
            channelId: 'channel',
            xpAmount: 1,
        }), false);
        assert.equal(await store.countProcessedLevelMessage('guild', 'message', 'profile'), 1);
    });
});

test('level test rollback subtracts only the test delta and preserves earned XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { createXpTest, rollbackLevelTest } = require('../utils/levelingTests');
        const member = fakeMember();
        await store.setUserXp({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            textXp: 100,
            voiceXp: 0,
            source: 'seed',
        });

        const testSession = await createXpTest(member, {
            adminId: 'admin',
            amount: 500,
            previewOnly: false,
            applyRoles: false,
        });
        await store.adjustUserXp({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            xpType: 'text',
            amount: 25,
            source: 'live_message',
        });

        const rollback = await rollbackLevelTest(member, { adminId: 'admin' });
        const record = await store.getUserLevelRecord('guild', 'user');

        assert.equal(testSession.session.xpDelta, 500);
        assert.equal(rollback.ok, true);
        assert.equal(record.textXp, 125);
    });
});

test('level records stay isolated by guild for leaderboard ranking', async () => {
    await withIsolatedStore(async ({ store }) => {
        await store.setUserXp({ guildId: 'guild-a', userId: 'same-user', textXp: 100, source: 'seed' });
        await store.setUserXp({ guildId: 'guild-b', userId: 'same-user', textXp: 1000, source: 'seed' });
        await store.setUserXp({ guildId: 'guild-a', userId: 'other-user', textXp: 200, source: 'seed' });

        assert.equal(await store.getLevelRank('guild-a', 'same-user', 'total'), 2);
        assert.equal(await store.getLevelRank('guild-b', 'same-user', 'total'), 1);
    });
});
