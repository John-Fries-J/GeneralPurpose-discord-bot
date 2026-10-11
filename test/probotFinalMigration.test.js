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
        '../utils/levelingCalibration',
        '../utils/levelingImport',
        '../utils/probotFinalMigration',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

async function withIsolatedStore(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-probot-final-'));
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

function fakeGuild(options = {}) {
    const members = options.members || new Map();
    return {
        id: options.guildId || 'guild',
        memberCount: options.memberCount ?? members.size,
        members: {
            cache: members,
            me: { permissions: { has: () => true }, roles: { highest: { position: 100 } } },
            fetch: options.fetchMembers || (async userId => {
                if (userId) return members.get(String(userId)) || null;
                return members;
            }),
        },
        roles: { cache: options.roles || new Map() },
    };
}

function fakeMember(userId, roleIds = []) {
    return {
        id: userId,
        user: { id: userId, tag: `${userId}#0001`, username: userId, bot: false },
        roles: { cache: new Map(roleIds.map(roleId => [roleId, { id: roleId }])) },
    };
}

async function seedAnnouncement(store, userId, level, overrides = {}) {
    return store.insertLevelProbotAnnouncement({
        guildId: overrides.guildId || 'guild',
        sourceChannelId: 'probot-channel',
        messageId: overrides.messageId || `probot-${userId}-${level}`,
        probotAuthorId: '282859044593598464',
        targetUserId: userId,
        announcedLevel: level,
        announcementTimestamp: overrides.timestamp || 1,
        parserVersion: 'test',
        parseStatus: 'verified',
        confidence: 'high',
        diagnostic: {},
    });
}

function gatewayRateLimitError(seconds = 0.001) {
    const error = new Error(`Request with opcode 8 was rate limited. Retry after ${seconds} seconds.`);
    error.name = 'GatewayRateLimitError';
    error.data = { opcode: 8, retry_after: seconds };
    return error;
}

test('final ProBot migration updates live XP for the Level 30 example and leaderboard', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = '630070645874622494';
        const guild = fakeGuild();
        const { applyFinalProbotMigration } = require('../utils/probotFinalMigration');
        const { getGuildLevelingConfig, getLevelProgress, getXpForLevel } = require('../utils/leveling');

        await seedAnnouncement(store, userId, 30);
        await store.setUserXp({
            guildId: 'guild',
            userId,
            userTag: 'Recovered#0001',
            textXp: 19,
            voiceXp: 0,
            source: 'live_seed',
        });

        const settings = await getGuildLevelingConfig('guild');
        const required = getXpForLevel(30, settings);
        const result = await applyFinalProbotMigration(guild, { targetUserId: userId, adminId: 'admin' });
        const record = await store.getUserLevelRecord('guild', userId);
        const progress = getLevelProgress(record, settings);
        const leaderboard = await store.listLevelLeaderboard('guild', 10, 'total', 0);

        assert.equal(result.batch.affectedCount, 1);
        assert.equal(record.textXp, required + 19);
        assert.equal(record.voiceXp, 0);
        assert.ok(progress.level >= 30);
        assert.equal(leaderboard[0].userId, userId);
    });
});

test('final ProBot rollback subtracts only the migration delta and preserves later XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = '630070645874622494';
        const guild = fakeGuild();
        const { applyFinalProbotMigration, rollbackFinalProbotMigration } = require('../utils/probotFinalMigration');

        await seedAnnouncement(store, userId, 30);
        await store.setUserXp({
            guildId: 'guild',
            userId,
            userTag: 'Recovered#0001',
            textXp: 19,
            voiceXp: 7,
            source: 'live_seed',
        });
        const applied = await applyFinalProbotMigration(guild, { targetUserId: userId, adminId: 'admin' });
        await store.adjustUserXp({ guildId: 'guild', userId, userTag: 'Recovered#0001', xpType: 'text', amount: 25, source: 'live_after_apply' });
        await store.adjustUserXp({ guildId: 'guild', userId, userTag: 'Recovered#0001', xpType: 'voice', amount: 3, source: 'voice_after_apply' });

        const rolledBack = await rollbackFinalProbotMigration(applied.batch.id, { adminId: 'admin' });
        const record = await store.getUserLevelRecord('guild', userId);

        assert.equal(rolledBack.rollbackCount, 1);
        assert.equal(record.textXp, 44);
        assert.equal(record.voiceXp, 10);
    });
});

test('final ProBot apply is transactional on partial failure', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { getXpForLevel } = require('../utils/leveling');
        await store.setUserXp({ guildId: 'guild', userId: 'valid-user', textXp: 5, voiceXp: 0, source: 'seed' });

        await assert.rejects(() => store.applyLevelProbotFinalMigration({
            guildId: 'guild',
            mode: 'server_apply',
            createdBy: 'admin',
            proposals: [
                { userId: 'valid-user', confirmedLevel: 1, requiredTotalXp: getXpForLevel(1), evidence: {} },
                { userId: null, confirmedLevel: 1, requiredTotalXp: getXpForLevel(1), evidence: {} },
            ],
        }));

        const record = await store.getUserLevelRecord('guild', 'valid-user');
        const batches = await store.listLevelProbotMigrationBatches('guild');

        assert.equal(record.textXp, 5);
        assert.equal(batches.length, 0);
    });
});

test('final ProBot migration repeat execution cannot duplicate XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = 'repeat-user';
        const guild = fakeGuild();
        const { applyFinalProbotMigration } = require('../utils/probotFinalMigration');

        await seedAnnouncement(store, userId, 5);
        await store.setUserXp({ guildId: 'guild', userId, textXp: 10, voiceXp: 0, source: 'live_seed' });

        const first = await applyFinalProbotMigration(guild, { targetUserId: userId, adminId: 'admin' });
        const afterFirst = await store.getUserLevelRecord('guild', userId);
        const second = await applyFinalProbotMigration(guild, { targetUserId: userId, adminId: 'admin' });
        const afterSecond = await store.getUserLevelRecord('guild', userId);
        const events = await store.listLevelXpEvents('guild', { userId, limit: 50 });

        assert.equal(first.batch.affectedCount, 1);
        assert.equal(second.batch.affectedCount, 0);
        assert.equal(afterSecond.textXp, afterFirst.textXp);
        assert.equal(events.filter(event => event.source === 'probot_final_migration').length, 1);
    });
});

test('final ProBot migration does not double-count prior historical imports', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = 'prior-history-user';
        const guild = fakeGuild();
        const { applyFinalProbotMigration } = require('../utils/probotFinalMigration');
        const { getXpForLevel } = require('../utils/leveling');
        const required = getXpForLevel(5);

        await seedAnnouncement(store, userId, 5);
        await store.setUserXp({ guildId: 'guild', userId, textXp: required + 19, voiceXp: 12, source: 'seed_current' });
        await store.insertLevelXpEvent({
            guildId: 'guild',
            userId,
            source: 'historical_import',
            sourceKey: 'historical-import:prior-history-user',
            xpType: 'text',
            amount: required,
            previousTextXp: 0,
            previousVoiceXp: 0,
            newTextXp: required,
            newVoiceXp: 0,
        });

        const result = await applyFinalProbotMigration(guild, { targetUserId: userId, adminId: 'admin' });
        const record = await store.getUserLevelRecord('guild', userId);

        assert.equal(result.batch.affectedCount, 0);
        assert.equal(record.textXp, required + 19);
        assert.equal(record.voiceXp, 12);
    });
});

test('final ProBot preview flags extreme estimated-only reconstructed outliers', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { updateLevelingSettings } = require('../utils/guildConfig');
        const { buildFinalProbotMigrationPreview } = require('../utils/probotFinalMigration');
        await updateLevelingSettings('guild', {
            progressionFormula: 'linear',
            xpPerLevelBase: 1,
            textXpMin: 1,
            textXpMax: 1,
            cooldownSeconds: 0,
        }, { actorId: 'admin' });
        const job = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'outlier-profile',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0 },
        });
        for (let index = 0; index < 75; index += 1) {
            await store.insertLevelImportMessage({
                jobId: job.job.id,
                guildId: 'guild',
                messageId: `message-${index}`,
                userId: 'estimated-user',
                channelId: 'channel',
                createdAt: index * 60_000,
                xpAmount: 1,
            });
        }

        const preview = await buildFinalProbotMigrationPreview(fakeGuild(), { importJobId: job.job.id });
        const record = preview.records.find(item => item.userId === 'estimated-user');

        assert.ok(record);
        assert.equal(record.confirmedMinimumLevel, 0);
        assert.equal(record.wouldChange, false);
        assert.ok(record.confidenceWarnings.includes('estimated_only_reconstruction_not_applied'));
        assert.ok(record.confidenceWarnings.includes('extreme_reconstructed_level_unreliable'));
    });
});

test('final ProBot preview retries gateway member-fetch rate limits and recovers role evidence', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { buildFinalProbotMigrationPreview } = require('../utils/probotFinalMigration');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-5',
            minimumLevel: 5,
            createdBy: 'admin',
        });
        const cache = new Map();
        const member = fakeMember('role-user', ['level-5']);
        let fetchCalls = 0;
        const guild = fakeGuild({
            members: cache,
            memberCount: 1,
            fetchMembers: async userId => {
                if (userId) return cache.get(String(userId)) || null;
                fetchCalls += 1;
                if (fetchCalls === 1) throw gatewayRateLimitError(0.001);
                cache.set(member.id, member);
                return cache;
            },
        });

        const preview = await buildFinalProbotMigrationPreview(guild, {
            memberFetch: {
                maxRetries: 1,
                minRetryDelayMs: 0,
                rateLimitBufferMs: 0,
                delay: async () => {},
            },
        });
        const record = preview.records.find(item => item.userId === 'role-user');

        assert.equal(fetchCalls, 2);
        assert.equal(preview.evidence.complete, true);
        assert.equal(preview.evidence.memberFetch.fetchAttempts, 2);
        assert.deepEqual(preview.evidence.memberFetch.retryDelaysMs, [1]);
        assert.equal(record.roleMinLevel, 5);
        assert.equal(record.confirmedMinimumLevel, 5);
        assert.equal(preview.canApply, true);
    });
});

test('final ProBot preview reuses complete cached members for role evidence', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { buildFinalProbotMigrationPreview } = require('../utils/probotFinalMigration');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-10',
            minimumLevel: 10,
            createdBy: 'admin',
        });
        const member = fakeMember('cached-user', ['level-10']);
        let fetchCalls = 0;
        const guild = fakeGuild({
            members: new Map([[member.id, member]]),
            memberCount: 1,
            fetchMembers: async () => {
                fetchCalls += 1;
                throw new Error('should not fetch when cache is complete');
            },
        });

        const preview = await buildFinalProbotMigrationPreview(guild);
        const record = preview.records.find(item => item.userId === 'cached-user');

        assert.equal(fetchCalls, 0);
        assert.equal(preview.evidence.memberFetch.source, 'cache_complete');
        assert.equal(preview.evidence.complete, true);
        assert.equal(record.roleMinLevel, 10);
    });
});

test('final ProBot preview marks incomplete member lists as partial and non-authoritative', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { buildFinalProbotMigrationPreview } = require('../utils/probotFinalMigration');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-5',
            minimumLevel: 5,
            createdBy: 'admin',
        });
        const member = fakeMember('partial-user', ['level-5']);
        const partialMembers = new Map([[member.id, member]]);
        const guild = fakeGuild({
            members: new Map(),
            memberCount: 2,
            fetchMembers: async () => partialMembers,
        });

        const preview = await buildFinalProbotMigrationPreview(guild);
        const record = preview.records.find(item => item.userId === 'partial-user');

        assert.equal(preview.authoritative, false);
        assert.equal(preview.canApply, false);
        assert.equal(preview.evidence.complete, false);
        assert.match(preview.evidence.error, /Fetched 1 of 2/);
        assert.equal(preview.summary.countsArePartial, true);
        assert.equal(record.roleMinLevel, 5);
        assert.ok(record.confidenceWarnings.includes('member_fetch_was_partial'));
    });
});

test('final ProBot preview uses partial cache after failed fetch without making counts authoritative', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { buildFinalProbotMigrationPreview } = require('../utils/probotFinalMigration');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-7',
            minimumLevel: 7,
            createdBy: 'admin',
        });
        const member = fakeMember('cached-partial-user', ['level-7']);
        const guild = fakeGuild({
            members: new Map([[member.id, member]]),
            memberCount: 2,
            fetchMembers: async () => {
                throw new Error('gateway unavailable');
            },
        });

        const preview = await buildFinalProbotMigrationPreview(guild, {
            memberFetch: { maxRetries: 0 },
        });
        const record = preview.records.find(item => item.userId === 'cached-partial-user');

        assert.equal(preview.authoritative, false);
        assert.equal(preview.canApply, false);
        assert.equal(preview.evidence.memberFetch.source, 'cache_partial_after_fetch_error');
        assert.match(preview.evidence.error, /gateway unavailable/);
        assert.equal(record.roleMinLevel, 7);
        assert.ok(preview.warnings.some(warning => warning.includes('Preview counts are partial')));
    });
});

test('current-members-only final ProBot apply rejects incomplete member fetch before writing XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = 'current-user';
        const { applyFinalProbotMigration } = require('../utils/probotFinalMigration');
        await seedAnnouncement(store, userId, 5);
        await store.setUserXp({ guildId: 'guild', userId, textXp: 3, voiceXp: 0, source: 'seed' });
        const member = fakeMember(userId);
        const guild = fakeGuild({
            members: new Map([[member.id, member]]),
            memberCount: 2,
            fetchMembers: async () => {
                throw new Error('guild member fetch failed');
            },
        });

        await assert.rejects(
            () => applyFinalProbotMigration(guild, {
                currentMemberOnly: true,
                adminId: 'admin',
                memberFetch: { maxRetries: 0 },
            }),
            error => {
                assert.equal(error.code, 'FINAL_PROBOT_MIGRATION_EVIDENCE_INCOMPLETE');
                assert.match(error.message, /current-member filter/i);
                return true;
            },
        );
        const record = await store.getUserLevelRecord('guild', userId);
        const batches = await store.listLevelProbotMigrationBatches('guild');

        assert.equal(record.textXp, 3);
        assert.equal(batches.length, 0);
    });
});

test('final ProBot apply rejects incomplete role evidence before writing XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const userId = 'role-blocked-user';
        const { applyFinalProbotMigration } = require('../utils/probotFinalMigration');
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-12',
            minimumLevel: 12,
            createdBy: 'admin',
        });
        await store.setUserXp({ guildId: 'guild', userId, textXp: 1, voiceXp: 0, source: 'seed' });
        const member = fakeMember(userId, ['level-12']);
        const guild = fakeGuild({
            members: new Map([[member.id, member]]),
            memberCount: 2,
            fetchMembers: async () => {
                throw new Error('member list unavailable');
            },
        });

        await assert.rejects(
            () => applyFinalProbotMigration(guild, {
                adminId: 'admin',
                memberFetch: { maxRetries: 0 },
            }),
            error => {
                assert.equal(error.code, 'FINAL_PROBOT_MIGRATION_EVIDENCE_INCOMPLETE');
                assert.match(error.message, /role evidence/i);
                return true;
            },
        );
        const record = await store.getUserLevelRecord('guild', userId);
        const batches = await store.listLevelProbotMigrationBatches('guild');

        assert.equal(record.textXp, 1);
        assert.equal(batches.length, 0);
    });
});
