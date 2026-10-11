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
        '../utils/levelingCalibration',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

async function withIsolatedStore(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-leveling-calibration-'));
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

function fakeMember(userId, roleIds = []) {
    return {
        id: userId,
        user: { id: userId, tag: `${userId}#0001`, username: userId, bot: false },
        roles: { cache: new Map(roleIds.map(roleId => [roleId, { id: roleId }])) },
    };
}

function fakeGuild(members = []) {
    const memberMap = new Map(members.map(member => [member.id, member]));
    return {
        id: 'guild',
        memberCount: members.length,
        members: {
            cache: memberMap,
            fetch: async userId => {
                if (userId) {
                    const member = memberMap.get(String(userId));
                    if (!member) throw new Error('Unknown member');
                    return member;
                }
                return memberMap;
            },
        },
    };
}

function fakeClient(guild) {
    return {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async () => guild,
        },
    };
}

async function waitForCalibrationJob(store, jobId, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const job = await store.getLevelCalibrationJob(jobId);
        if (['completed', 'failed', 'cancelled'].includes(job?.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Calibration job ${jobId} did not finish`);
}

test('calibration role evidence uses the highest mapped role as a confirmed minimum', () => {
    const { deriveRoleEvidenceForMember } = require('../utils/levelingCalibration');
    const member = fakeMember('user', ['level-50']);
    const evidence = deriveRoleEvidenceForMember(member, [
        { roleId: 'level-10', minimumLevel: 10 },
        { roleId: 'level-50', minimumLevel: 50 },
        { roleId: 'level-70', minimumLevel: 70 },
    ]);

    assert.equal(evidence.roleMinLevel, 50);
    assert.equal(evidence.roleMinRoleId, 'level-50');
    assert.equal(evidence.upperBoundLevel, 70);
    assert.equal(evidence.upperBoundReliable, false);
    assert.ok(evidence.notes.includes('upper_bound_is_tentative'));
    assert.ok(evidence.notes.includes('replacement_style_or_missing_lower_roles'));
});

test('calibration role mappings combine explicit recovery mappings and configured reward roles', () => {
    const { getLevelingConfig } = require('../utils/leveling');
    const { normalizeCalibrationRoleMappings } = require('../utils/levelingCalibration');
    const settings = getLevelingConfig({
        leveling: {
            roleRewards: [
                { roleId: 'reward-20', level: 20 },
                { roleId: 'reward-xp', xp: 1500 },
                { roleId: 'explicit', level: 99 },
            ],
        },
    });

    const mappings = normalizeCalibrationRoleMappings({
        recoveryMappings: [{ roleId: 'explicit', minimumLevel: 50 }],
        roleRewards: settings.roleRewards,
        settings,
    });

    assert.deepEqual(mappings.map(mapping => [mapping.roleId, mapping.minimumLevel, mapping.source]), [
        ['reward-xp', 5, 'reward_role'],
        ['reward-20', 20, 'reward_role'],
        ['explicit', 50, 'role_map'],
    ]);
});

test('calibration replay preserves chronological cooldown across channels', () => {
    const { replayMessagesForProfiles } = require('../utils/levelingCalibration');
    const [result] = replayMessagesForProfiles([
        { guildId: 'guild', userId: 'user', messageId: 'later', channelId: 'b', createdAt: 60_000, xpAmount: 1, eligible: true },
        { guildId: 'guild', userId: 'user', messageId: 'cooldown', channelId: 'a', createdAt: 30_000, xpAmount: 1, eligible: true },
        { guildId: 'guild', userId: 'user', messageId: 'early', channelId: 'a', createdAt: 0, xpAmount: 1, eligible: true },
    ], [{
        label: 'ten-xp',
        settings: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 60, progressionFormula: 'legacy', xpPerLevelBase: 100 },
    }]);

    assert.equal(result.awardedMessages, 2);
    assert.equal(result.recordsByUser.get('user').reconstructedXp, 20);
});

test('calibration replay recalculates alternative XP instead of trusting stored xp_amount', () => {
    const { replayMessagesForProfiles } = require('../utils/levelingCalibration');
    const [result] = replayMessagesForProfiles([
        { guildId: 'guild', userId: 'user', messageId: 'message', channelId: 'a', createdAt: 0, xpAmount: 1, eligible: true },
    ], [{
        label: 'twenty-xp',
        settings: { textXpMin: 20, textXpMax: 20, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
    }]);

    assert.equal(result.recordsByUser.get('user').reconstructedXp, 20);
});

test('tentative upper bounds are reported separately from minimum-level violations', () => {
    const { scoreSimulationAgainstEvidence } = require('../utils/levelingCalibration');
    const evidence = new Map([['user', {
        userId: 'user',
        roleMinLevel: 10,
        upperBoundLevel: 20,
    }]]);
    const simulation = {
        recordsByUser: new Map([['user', { userId: 'user', reconstructedLevel: 30, reconstructedXp: 100000 }]]),
        records: [],
    };

    const score = scoreSimulationAgainstEvidence(simulation, evidence);

    assert.equal(score.minimumViolations, 0);
    assert.equal(score.tentativeOverestimations, 1);
    assert.equal(score.significantOverestimations, 1);
});

test('protected preview keeps role-confirmed minimums separate from reconstructed levels', () => {
    const { buildProtectedRecords } = require('../utils/levelingCalibration');
    const simulation = {
        profile: { settings: { progressionFormula: 'legacy', xpPerLevelBase: 100 } },
        recordsByUser: new Map([['user', { userId: 'user', reconstructedLevel: 12, reconstructedXp: 7800, awardedMessages: 100 }]]),
        records: [],
    };
    const evidence = new Map([['user', {
        userId: 'user',
        roleMinLevel: 50,
        roleMinRoleId: 'level-50',
    }]]);

    const [record] = buildProtectedRecords(simulation, evidence);

    assert.equal(record.reconstructedLevel, 12);
    assert.equal(record.protectedLevel, 50);
    assert.equal(record.minimumViolation, true);
});

test('protected preview can restrict output to explicitly requested users', () => {
    const { buildProtectedRecords } = require('../utils/levelingCalibration');
    const simulation = {
        profile: { settings: { progressionFormula: 'legacy', xpPerLevelBase: 100 } },
        recordsByUser: new Map([
            ['requested', { userId: 'requested', reconstructedLevel: 5, reconstructedXp: 1500 }],
            ['unrelated', { userId: 'unrelated', reconstructedLevel: 70, reconstructedXp: 248500 }],
        ]),
        records: [],
    };
    const evidence = new Map([
        ['requested', { userId: 'requested', roleMinLevel: 10 }],
        ['unrelated', { userId: 'unrelated', roleMinLevel: 70 }],
    ]);

    const records = buildProtectedRecords(simulation, evidence, { restrictToUserIds: new Set(['requested']) });

    assert.deepEqual(records.map(record => record.userId), ['requested']);
});

test('evidence diagnostics include activity counts, intervals, and coverage groups', () => {
    const { buildProtectedRecords } = require('../utils/levelingCalibration');
    const simulation = {
        profile: { settings: { progressionFormula: 'legacy', xpPerLevelBase: 100 } },
        recordsByUser: new Map([['user', {
            userId: 'user',
            reconstructedLevel: 20,
            reconstructedXp: 21000,
            accessibleMessages: 300,
            cooldownAdjustedMessages: 120,
            awardedMessages: 120,
            firstObservedAt: 0,
            lastObservedAt: 10 * 86_400_000,
        }]]),
        records: [],
    };
    const evidence = new Map([['user', { userId: 'user', roleMinLevel: 20, upperBoundLevel: 30 }]]);

    const [record] = buildProtectedRecords(simulation, evidence);

    assert.equal(record.accessibleMessages, 300);
    assert.equal(record.cooldownAdjustedMessages, 120);
    assert.equal(record.insideTentativeInterval, true);
    assert.equal(record.coverageGroup, 'substantial_surviving_history');
});

test('import completeness reports skipped channels and partial scans', () => {
    const { importCompleteness } = require('../utils/levelingCalibration');
    const result = importCompleteness({
        status: 'completed',
        channelsTotal: 10,
        channelsScanned: 9,
        skippedChannels: [{ channelId: 'hidden' }],
        errors: [],
    });

    assert.equal(result.complete, false);
    assert.deepEqual(result.warnings.map(warning => warning.type), ['skipped_channels', 'partial_channel_scan']);
});

test('calibration can replay absent or deleted users from stored messages', () => {
    const { replayMessagesForProfiles } = require('../utils/levelingCalibration');
    const [result] = replayMessagesForProfiles([
        { guildId: 'guild', userId: 'deleted-user', userTag: 'Deleted User', messageId: 'message', channelId: 'a', createdAt: 0, xpAmount: 1, eligible: true },
    ], [{
        label: 'profile',
        settings: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
    }]);

    assert.equal(result.usersReconstructed, 1);
    assert.equal(result.records[0].userTag, 'Deleted User');
});

test('calibration replay keeps large datasets bounded to per-user state', () => {
    const { replayMessagesForProfiles } = require('../utils/levelingCalibration');
    const messages = Array.from({ length: 20_001 }, (_, index) => ({
        guildId: 'guild',
        userId: 'user',
        messageId: `message-${index}`,
        channelId: 'a',
        createdAt: index * 60_000,
        xpAmount: 1,
        eligible: true,
    }));
    const [result] = replayMessagesForProfiles(messages, [{
        label: 'profile',
        settings: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
    }]);

    assert.equal(result.usersReconstructed, 1);
    assert.equal(result.records[0].awardedMessages, 20_001);
    assert.equal(Object.hasOwn(result.records[0], 'messageIds'), false);
});

test('stored import calibration replay is read-only and does not mark messages processed', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { getLevelingConfig } = require('../utils/leveling');
        const { replayImportJobProfiles } = require('../utils/levelingCalibration');
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 60, progressionFormula: 'legacy', xpPerLevelBase: 100 },
        });

        await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message-1',
            userId: 'user',
            userTag: 'User#0001',
            channelId: 'channel',
            createdAt: 0,
            xpAmount: 1,
            eligible: true,
        });

        const [result] = await replayImportJobProfiles(created.job.id, [{
            label: 'alternative',
            settings: getLevelingConfig({ leveling: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 0 } }),
        }]);

        const messages = await store.listLevelImportMessages(created.job.id, { limit: 10 });
        const reconciliations = await store.listLevelReconciliationRecords(created.job.id, { limit: 10 });
        const processed = await store.listLevelProcessedMessages('guild', { limit: 10 });

        assert.equal(result.recordsByUser.get('user').reconstructedXp, 10);
        assert.equal(messages[0].xpAmount, 1);
        assert.equal(reconciliations.length, 0);
        assert.equal(processed.length, 0);
    });
});

test('background calibration job completes without mutating XP, roles, or import rows', async () => {
    await withIsolatedStore(async ({ store }) => {
        const {
            processLevelCalibrationJob,
        } = require('../utils/levelingCalibration');
        const { updateLevelingSettings } = require('../utils/guildConfig');
        await updateLevelingSettings('guild', {
            textXpMin: 99,
            textXpMax: 99,
            cooldownSeconds: 0,
        }, { actorId: 'admin' });
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
        });
        await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            userTag: 'User#0001',
            channelId: 'channel',
            createdAt: 0,
            xpAmount: 1,
            eligible: true,
        });
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-1',
            minimumLevel: 1,
            createdBy: 'admin',
        });
        const member = fakeMember('user', ['level-1']);
        const calibration = await store.createLevelCalibrationJob({
            guildId: 'guild',
            importJobId: created.job.id,
            kind: 'preview',
            profile: {
                label: 'fixed',
                settings: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
            },
        });

        const result = await processLevelCalibrationJob(fakeClient(fakeGuild([member])), calibration.job.id);
        const messages = await store.listLevelImportMessages(created.job.id, { limit: 10 });
        const processed = await store.listLevelProcessedMessages('guild', { limit: 10 });

        assert.equal(result.status, 'completed');
        assert.equal(result.result.records[0].reconstructedXp, 10);
        assert.equal(await store.getUserLevelRecord('guild', 'user'), null);
        assert.equal(processed.length, 0);
        assert.equal(messages[0].xpAmount, 1);
        assert.equal(member.roles.cache.has('level-1'), true);
    });
});

test('calibration jobs reject concurrent runs for the same completed import', async () => {
    await withIsolatedStore(async ({ store }) => {
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1 },
        });
        const first = await store.createLevelCalibrationJob({
            guildId: 'guild',
            importJobId: created.job.id,
            kind: 'preview',
        });
        const second = await store.createLevelCalibrationJob({
            guildId: 'guild',
            importJobId: created.job.id,
            kind: 'fit',
        });

        assert.equal(first.ok, true);
        assert.equal(second.ok, false);
        assert.equal(second.reason, 'active_job');
        assert.equal(second.job.id, first.job.id);
    });
});

test('starting calibration job defers replay so command replies can stay responsive', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { startLevelCalibrationJob } = require('../utils/levelingCalibration');
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
        });
        await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            channelId: 'channel',
            createdAt: 0,
            xpAmount: 1,
            eligible: true,
        });

        const started = await startLevelCalibrationJob(fakeClient(fakeGuild([])), fakeGuild([]), {
            importJobId: created.job.id,
            kind: 'preview',
            profile: {
                label: 'fixed',
                settings: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
            },
        });
        const queued = await store.getLevelCalibrationJob(started.job.id);
        const finished = await waitForCalibrationJob(store, started.job.id);

        assert.equal(started.ok, true);
        assert.equal(queued.status, 'queued');
        assert.equal(finished.status, 'completed');
    });
});

test('calibration fit defaults to ten candidate profiles', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processLevelCalibrationJob } = require('../utils/levelingCalibration');
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
        });
        await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            channelId: 'channel',
            createdAt: 0,
            xpAmount: 1,
            eligible: true,
        });
        await store.upsertLevelRoleMapping({
            guildId: 'guild',
            roleId: 'level-1',
            minimumLevel: 1,
            createdBy: 'admin',
        });
        const calibration = await store.createLevelCalibrationJob({
            guildId: 'guild',
            importJobId: created.job.id,
            kind: 'fit',
        });

        const result = await processLevelCalibrationJob(fakeClient(fakeGuild([fakeMember('user', ['level-1'])])), calibration.job.id);

        assert.equal(result.status, 'completed');
        assert.equal(result.result.candidateProfiles, 10);
    });
});

test('calibration resume recovers queued or running jobs after restart', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { resumeLevelCalibrationJobs } = require('../utils/levelingCalibration');
        const created = await store.createLevelImportJob({
            guildId: 'guild',
            status: 'completed',
            dryRun: true,
            profileHash: 'legacy',
            profile: { textXpMin: 1, textXpMax: 1, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
        });
        await store.insertLevelImportMessage({
            jobId: created.job.id,
            guildId: 'guild',
            messageId: 'message',
            userId: 'user',
            channelId: 'channel',
            createdAt: 0,
            xpAmount: 1,
            eligible: true,
        });
        const calibration = await store.createLevelCalibrationJob({
            guildId: 'guild',
            importJobId: created.job.id,
            kind: 'preview',
            status: 'running',
            profile: {
                label: 'fixed',
                settings: { textXpMin: 10, textXpMax: 10, cooldownSeconds: 0, progressionFormula: 'legacy', xpPerLevelBase: 100 },
            },
        });

        const resumed = await resumeLevelCalibrationJobs(fakeClient(fakeGuild([])));
        const finished = await waitForCalibrationJob(store, calibration.job.id);

        assert.equal(resumed, 1);
        assert.equal(finished.status, 'completed');
    });
});
