const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

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

function fakeMember(guildId = 'guild', userId = 'user', options = {}) {
    const roleCache = new Map((options.roleIds || []).map(roleId => [roleId, { id: roleId }]));
    const guildRoles = new Map((options.guildRoleIds || options.roleIds || []).map((roleId, index) => [roleId, { id: roleId, position: index + 1 }]));
    return {
        id: userId,
        user: { id: userId, tag: 'User#0001', username: 'User', bot: false },
        guild: {
            id: guildId,
            roles: { cache: guildRoles },
            members: { me: { permissions: { has: () => options.canManageRoles !== false }, roles: { highest: { position: 100 } } } },
        },
        roles: {
            cache: roleCache,
            add: async roleId => roleCache.set(roleId, { id: roleId }),
            remove: async roleId => roleCache.delete(roleId),
        },
    };
}

function fakeImportClient(guild) {
    return {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async () => guild,
        },
    };
}

function fakeGuild(channels = [], options = {}) {
    const cache = new Map(channels.map(channel => [channel.id, channel]));
    return {
        id: options.guildId || 'guild',
        memberCount: options.memberCount || 0,
        channels: {
            cache,
            fetch: async () => cache,
        },
        roles: { cache: options.roles || new Map() },
        members: {
            cache: options.members || new Map(),
            me: options.botMember || { permissions: { has: () => true }, roles: { highest: { position: 100 } } },
            fetch: options.fetchMembers || (async () => options.members || new Map()),
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

test('only one active historical import job can be created per guild', async () => {
    await withIsolatedStore(async ({ store }) => {
        const first = await store.createLevelImportJob({
            guildId: 'guild',
            profileHash: 'profile-a',
            profile: { textXpMin: 1, textXpMax: 1 },
        });
        const second = await store.createLevelImportJob({
            guildId: 'guild',
            profileHash: 'profile-b',
            profile: { textXpMin: 1, textXpMax: 1 },
        });

        assert.equal(first.ok, true);
        assert.equal(second.ok, false);
        assert.equal(second.reason, 'active_job');
        assert.equal(second.job.id, first.job.id);
    });
});

test('historical import reconciliation streams beyond one hundred thousand messages', async () => {
    await withIsolatedStore(async ({ database, store, sqlitePath }) => {
        const repository = require('../database/repositories/storeRepository');
        const { processLevelImportJob } = require('../utils/levelingImport');
        const db = await database.openDatabase(sqlitePath);
        const created = repository.createLevelImportJob(db, {
            guildId: 'guild',
            dryRun: true,
            profileHash: 'profile-large',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, reconciliationPolicy: 'max' },
        });
        const insert = db.prepare(`
            INSERT INTO level_import_messages (
                job_id, guild_id, message_id, user_id, user_tag, channel_id,
                created_at, xp_amount, eligible, skip_reason
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 1, NULL)
        `);
        db.transaction(() => {
            for (let index = 0; index < 100_001; index += 1) {
                insert.run(created.job.id, 'guild', `message-${String(index).padStart(6, '0')}`, 'user', 'channel', index * 60_000);
            }
        })();

        const guild = fakeGuild([], { guildId: 'guild' });
        const job = await processLevelImportJob(fakeImportClient(guild), created.job.id);

        assert.equal(job.status, 'completed');
        assert.equal(job.result.messagesStored, 100_001);
        assert.equal(job.result.usersReconciled, 1);
        assert.equal(job.xpEstimated, 100_001);
        assert.equal((await store.listLevelReconciliationRecords(created.job.id, { limit: 10 }))[0].messageEstimatedXp, 100_001);
    });
});

test('historical import blocks apply when channel scans are skipped or failed', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processLevelImportJob } = require('../utils/levelingImport');
        const inaccessible = {
            id: 'hidden',
            name: 'hidden',
            type: ChannelType.GuildText,
            messages: { fetch: async () => new Map() },
            permissionsFor: () => ({ has: () => false }),
        };
        const failing = {
            id: 'failing',
            name: 'failing',
            type: ChannelType.GuildText,
            messages: { fetch: async () => { throw new Error('Discord API unavailable'); } },
            permissionsFor: () => ({ has: () => true }),
        };
        const guild = fakeGuild([inaccessible, failing], { guildId: 'guild' });
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            dryRun: false,
            profileHash: 'profile-incomplete',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, reconciliationPolicy: 'max' },
        });

        const job = await processLevelImportJob(fakeImportClient(guild), created.job.id);

        assert.equal(job.status, 'needs_confirmation');
        assert.equal(job.xpApplied, 0);
        assert.equal(job.skippedChannels.length, 1);
        assert.equal(job.errors.length, 1);
        assert.equal(job.result.incomplete, true);
        assert.equal(job.result.requiresConfirmation, true);
    });
});

test('role recovery refuses to apply partial guild-member fetch results', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { previewRoleRecovery } = require('../utils/levelingImport');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-5',
            minimumLevel: 5,
            createdBy: 'admin',
        });
        const member = fakeMember('guild', 'user', { roleIds: ['level-5'] });
        const members = new Map([[member.id, member]]);
        const guild = fakeGuild([], {
            guildId: 'guild',
            memberCount: 2,
            members,
            fetchMembers: async () => members,
        });

        const result = await previewRoleRecovery(guild, { apply: true, adminId: 'admin' });

        assert.equal(result.complete, false);
        assert.equal(result.applied, 0);
        assert.match(result.error, /Fetched 1 of 2/);
        assert.equal(await store.getUserLevelRecord('guild', 'user'), null);
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

test('level test rollback preserves roles still earned after concurrent XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { updateLevelingSettings } = require('../utils/guildConfig');
        const { createXpTest, rollbackLevelTest } = require('../utils/levelingTests');
        await updateLevelingSettings('guild', {
            roleRewards: [{ level: 1, roleId: 'level-1' }],
        }, { actorId: 'admin' });
        const member = fakeMember('guild', 'user', { guildRoleIds: ['level-1'] });
        await store.setUserXp({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            textXp: 90,
            voiceXp: 0,
            source: 'seed',
        });

        const testSession = await createXpTest(member, {
            adminId: 'admin',
            amount: 20,
            previewOnly: false,
            applyRoles: true,
            awardMissingRoles: true,
        });
        await store.adjustUserXp({
            guildId: 'guild',
            userId: 'user',
            userTag: 'User#0001',
            xpType: 'text',
            amount: 10,
            source: 'live_message',
        });

        const rollback = await rollbackLevelTest(member, { adminId: 'admin' });
        const record = await store.getUserLevelRecord('guild', 'user');

        assert.equal(testSession.roleChanges.added.includes('level-1'), true);
        assert.equal(rollback.ok, true);
        assert.equal(record.textXp, 100);
        assert.equal(member.roles.cache.has('level-1'), true);
        assert.deepEqual(rollback.roleChanges.removed, []);
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
