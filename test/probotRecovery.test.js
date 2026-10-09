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
        '../utils/levelingCalibration',
        '../utils/levelingImport',
        '../utils/probotRecovery',
        '../utils/probotLevelParser',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

async function withIsolatedStore(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-probot-recovery-'));
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

function parserMessage(overrides = {}) {
    return {
        id: overrides.id || 'message',
        content: Object.hasOwn(overrides, 'content') ? overrides.content : '<@123456789012345678>, you\'ve reached level 30! 🥳',
        author: { id: overrides.authorId || '282859044593598464', bot: true },
        mentions: { users: new Map(overrides.mentionIds?.map(id => [id, { id }]) || []) },
        embeds: overrides.embeds || [],
        createdTimestamp: overrides.createdTimestamp || 1,
    };
}

function fakeMessage(id, createdTimestamp, overrides = {}) {
    return {
        ...parserMessage({
            id,
            createdTimestamp,
            content: overrides.content || `<@${overrides.userId || '100000000000000001'}>, you've reached level ${overrides.level || 1}!`,
            mentionIds: overrides.mentionIds || [overrides.userId || '100000000000000001'],
            authorId: overrides.authorId,
            embeds: overrides.embeds,
        }),
        webhookId: overrides.webhookId || null,
    };
}

function pageFetcher(messages, options = {}) {
    const sorted = [...messages].sort((a, b) => Number(b.createdTimestamp) - Number(a.createdTimestamp));
    let calls = 0;
    return async fetchOptions => {
        calls += 1;
        if (options.failFromCall && calls >= options.failFromCall) throw new Error('Discord API unavailable');
        if (options.failAtCall && calls === options.failAtCall) throw new Error('Discord API unavailable');
        const beforeIndex = fetchOptions.before
            ? sorted.findIndex(message => message.id === fetchOptions.before)
            : -1;
        const start = beforeIndex >= 0 ? beforeIndex + 1 : 0;
        const page = sorted.slice(start, start + (fetchOptions.limit || 100));
        return new Map(page.map(message => [message.id, message]));
    };
}

function fakeChannel(id, guild, messages = [], options = {}) {
    return {
        id,
        name: id,
        type: options.type ?? ChannelType.GuildText,
        guild,
        guildId: guild.id,
        parentId: options.parentId || null,
        messages: { fetch: pageFetcher(messages, options) },
        permissionsFor: () => ({ has: () => options.canRead !== false }),
    };
}

function fakeGuild(channels = [], options = {}) {
    const cache = new Map();
    const guild = {
        id: options.guildId || 'guild',
        memberCount: options.memberCount || 0,
        channels: {
            cache,
            fetch: async channelId => cache.get(channelId) || null,
        },
        members: {
            cache: options.members || new Map(),
            me: { permissions: { has: () => true } },
            fetch: options.fetchMembers || (async userId => {
                if (userId) return options.members?.get(String(userId)) || null;
                return options.members || new Map();
            }),
        },
    };
    for (const channel of channels) cache.set(channel.id, channel);
    return guild;
}

function fakeClient(guild) {
    return {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async () => guild,
        },
    };
}

test('parser requires the exact ProBot author', () => {
    const { parseProBotLevelAnnouncement } = require('../utils/probotLevelParser');
    const parsed = parseProBotLevelAnnouncement(parserMessage({ authorId: 'not-probot' }));

    assert.equal(parsed.parseStatus, 'non_probot_author');
    assert.equal(parsed.ok, false);
});

test('parser accepts plain text announcements with a real user mention', () => {
    const { parseProBotLevelAnnouncement } = require('../utils/probotLevelParser');
    const parsed = parseProBotLevelAnnouncement(parserMessage({
        content: '<@123456789012345678>, you\'ve reached level 100! 🥳',
    }));

    assert.equal(parsed.parseStatus, 'verified');
    assert.equal(parsed.targetUserId, '123456789012345678');
    assert.equal(parsed.announcedLevel, 100);
});

test('parser accepts embed descriptions and fields', () => {
    const { parseProBotLevelAnnouncement } = require('../utils/probotLevelParser');
    const parsed = parseProBotLevelAnnouncement(parserMessage({
        content: '',
        embeds: [{
            description: '<@123456789012345678>, you have reached level 10!',
            fields: [{ name: 'Ignored', value: 'rank #5' }],
        }],
    }));

    assert.equal(parsed.parseStatus, 'verified');
    assert.equal(parsed.targetUserId, '123456789012345678');
    assert.equal(parsed.announcedLevel, 10);
    assert.equal(parsed.contentSource, 'embed_0_description');
});

test('parser records username-only announcements as unresolved', () => {
    const { parseProBotLevelAnnouncement } = require('../utils/probotLevelParser');
    const parsed = parseProBotLevelAnnouncement(parserMessage({
        content: '@Member, you\'ve reached level 30! 🥳',
    }));

    assert.equal(parsed.parseStatus, 'unresolved_identity');
    assert.equal(parsed.targetUserId, null);
    assert.equal(parsed.announcedLevel, 30);
    assert.equal(parsed.diagnostic.unresolvedName, '@Member');
});

test('parser rejects malformed and invalid levels', () => {
    const { parseProBotLevelAnnouncement } = require('../utils/probotLevelParser');

    assert.equal(parseProBotLevelAnnouncement(parserMessage({
        content: '<@123456789012345678>, level leaderboard is ready',
    })).parseStatus, 'invalid_format');
    assert.equal(parseProBotLevelAnnouncement(parserMessage({
        content: '<@123456789012345678>, you\'ve reached level 0!',
    })).parseStatus, 'invalid_level');
});

test('storage deduplicates announcements and aggregates highest verified level', async () => {
    await withIsolatedStore(async ({ store }) => {
        const base = {
            guildId: 'guild',
            sourceChannelId: 'channel',
            probotAuthorId: '282859044593598464',
            parserVersion: 'test',
            confidence: 'high',
            contentSource: 'content',
            announcementTimestamp: 1,
            diagnostic: {},
        };

        assert.equal((await store.insertLevelProbotAnnouncement({
            ...base,
            messageId: 'message-1',
            targetUserId: 'user',
            announcedLevel: 10,
            parseStatus: 'verified',
        })).inserted, true);
        assert.equal((await store.insertLevelProbotAnnouncement({
            ...base,
            messageId: 'message-1',
            targetUserId: 'user',
            announcedLevel: 10,
            parseStatus: 'verified',
        })).inserted, false);
        const repeated = await store.insertLevelProbotAnnouncement({
            ...base,
            messageId: 'message-2',
            targetUserId: 'user',
            announcedLevel: 10,
            parseStatus: 'verified',
        });
        await store.insertLevelProbotAnnouncement({
            ...base,
            messageId: 'message-3',
            targetUserId: 'user',
            announcedLevel: 30,
            parseStatus: 'verified',
        });

        const [highest] = await store.listHighestProbotAnnouncementLevels('guild');

        assert.equal(repeated.record.parseStatus, 'repeated_verified');
        assert.equal(highest.userId, 'user');
        assert.equal(highest.announcementLevel, 30);
        assert.equal(highest.announcementCount, 3);
    });
});

test('SQLite ProBot announcement upsert upgrades invalid and unresolved evidence to verified', async () => {
    await withIsolatedStore(async ({ store }) => {
        const base = {
            guildId: 'guild',
            sourceChannelId: 'channel',
            probotAuthorId: '282859044593598464',
            parserVersion: 'parser-v1',
            confidence: 'none',
            contentSource: 'content',
            announcementTimestamp: 1,
            diagnostic: {},
        };
        const cases = [
            {
                messageId: 'invalid-message',
                original: { parseStatus: 'invalid_format', announcedLevel: null },
                verified: { targetUserId: 'user-a', announcedLevel: 10 },
            },
            {
                messageId: 'unresolved-message',
                original: { parseStatus: 'unresolved_identity', announcedLevel: 20 },
                verified: { targetUserId: 'user-b', announcedLevel: 20 },
            },
        ];

        for (const item of cases) {
            assert.equal((await store.insertLevelProbotAnnouncement({
                ...base,
                messageId: item.messageId,
                targetUserId: null,
                ...item.original,
            })).inserted, true);
            const upgraded = await store.insertLevelProbotAnnouncement({
                ...base,
                messageId: item.messageId,
                jobId: 'verified-job',
                parserVersion: 'parser-v2',
                confidence: 'high',
                diagnostic: { reason: 'parser_fixed' },
                parseStatus: 'verified',
                ...item.verified,
            });

            assert.equal(upgraded.inserted, false);
            assert.equal(upgraded.updated, true);
            assert.equal(upgraded.record.parseStatus, 'verified');
            assert.equal(upgraded.record.targetUserId, item.verified.targetUserId);
            assert.equal(upgraded.record.announcedLevel, item.verified.announcedLevel);
            assert.equal(upgraded.record.parserVersion, 'parser-v2');
            assert.equal(upgraded.record.jobId, 'verified-job');
        }

        const records = await store.listLevelProbotAnnouncements('guild', { limit: 10 });
        const highest = await store.listHighestProbotAnnouncementLevels('guild');

        assert.equal(records.length, 2);
        assert.deepEqual(highest.map(row => row.userId).sort(), ['user-a', 'user-b']);
    });
});

test('SQLite ProBot announcement upsert never downgrades verified evidence', async () => {
    await withIsolatedStore(async ({ store }) => {
        const base = {
            guildId: 'guild',
            sourceChannelId: 'channel',
            messageId: 'message',
            probotAuthorId: '282859044593598464',
            announcementTimestamp: 1,
            contentSource: 'content',
        };

        assert.equal((await store.insertLevelProbotAnnouncement({
            ...base,
            jobId: 'verified-job',
            targetUserId: 'user',
            announcedLevel: 10,
            parserVersion: 'parser-v1',
            parseStatus: 'verified',
            confidence: 'high',
            diagnostic: { source: 'verified' },
        })).inserted, true);
        const downgraded = await store.insertLevelProbotAnnouncement({
            ...base,
            jobId: 'invalid-job',
            targetUserId: null,
            announcedLevel: null,
            parserVersion: 'parser-v2',
            parseStatus: 'invalid_format',
            confidence: 'none',
            diagnostic: { source: 'invalid' },
        });

        assert.equal(downgraded.inserted, false);
        assert.equal(downgraded.updated, false);
        assert.equal(downgraded.record.parseStatus, 'verified');
        assert.equal(downgraded.record.targetUserId, 'user');
        assert.equal(downgraded.record.announcedLevel, 10);
        assert.equal(downgraded.record.parserVersion, 'parser-v1');
        assert.equal(downgraded.record.jobId, 'verified-job');
        assert.deepEqual(downgraded.record.diagnostic, { source: 'verified' });
    });
});

test('scanner paginates, checkpoints, and excludes non-ProBot authors', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processProbotScanJob } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const messages = [
            fakeMessage('m3', 3, { level: 30, userId: '100000000000000001' }),
            fakeMessage('m2', 2, { authorId: 'other-bot', level: 20, userId: '100000000000000002' }),
            fakeMessage('m1', 1, { level: 10, userId: '100000000000000001' }),
        ];
        const channel = fakeChannel('channel', guild, messages);
        guild.channels.cache.set(channel.id, channel);
        const created = await store.createLevelProbotScanJob({
            guildId: 'guild',
            sourceChannelId: 'channel',
            sourceChannelIds: ['channel'],
            probotAuthorId: '282859044593598464',
        });

        const job = await processProbotScanJob(fakeClient(guild), created.job.id);
        const checkpoints = await store.listLevelProbotScanCheckpoints(created.job.id);
        const highest = await store.listHighestProbotAnnouncementLevels('guild');

        assert.equal(job.status, 'completed');
        assert.equal(job.scannedCount, 3);
        assert.equal(job.verifiedCount, 2);
        assert.equal(job.skippedCount, 1);
        assert.equal(checkpoints[0].status, 'completed');
        assert.equal(highest[0].announcementLevel, 30);
    });
});

test('new ProBot scan uses fresh checkpoints and upgrades prior unresolved announcements', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processProbotScanJob } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const unresolvedMessage = fakeMessage('m1', 1, {
            content: '@Member, you\'ve reached level 42!',
            mentionIds: [],
        });
        guild.channels.cache.set('channel', fakeChannel('channel', guild, [unresolvedMessage]));
        const first = await store.createLevelProbotScanJob({
            guildId: 'guild',
            sourceChannelId: 'channel',
            sourceChannelIds: ['channel'],
            probotAuthorId: '282859044593598464',
        });

        const firstJob = await processProbotScanJob(fakeClient(guild), first.job.id);
        const firstCheckpoints = await store.listLevelProbotScanCheckpoints(first.job.id);
        assert.equal(firstJob.status, 'completed');
        assert.equal(firstJob.unresolvedCount, 1);
        assert.equal(firstCheckpoints[0].status, 'completed');

        const verifiedMessage = fakeMessage('m1', 1, {
            level: 42,
            userId: '100000000000000001',
            mentionIds: ['100000000000000001'],
        });
        guild.channels.cache.set('channel', fakeChannel('channel', guild, [verifiedMessage]));
        const second = await store.createLevelProbotScanJob({
            guildId: 'guild',
            sourceChannelId: 'channel',
            sourceChannelIds: ['channel'],
            probotAuthorId: '282859044593598464',
        });

        const secondJob = await processProbotScanJob(fakeClient(guild), second.job.id);
        const secondCheckpoints = await store.listLevelProbotScanCheckpoints(second.job.id);
        const allCheckpoints = await store.listLevelProbotScanCheckpoints();
        const announcements = await store.listLevelProbotAnnouncements('guild', { limit: 10 });

        assert.equal(second.ok, true);
        assert.notEqual(second.job.id, first.job.id);
        assert.equal(secondJob.status, 'completed');
        assert.equal(secondJob.scannedCount, 1);
        assert.equal(secondJob.verifiedCount, 1);
        assert.equal(secondCheckpoints.length, 1);
        assert.equal(secondCheckpoints[0].jobId, second.job.id);
        assert.equal(secondCheckpoints[0].status, 'completed');
        assert.equal(allCheckpoints.length, 2);
        assert.equal(announcements.length, 1);
        assert.equal(announcements[0].parseStatus, 'verified');
        assert.equal(announcements[0].targetUserId, '100000000000000001');
        assert.equal(announcements[0].announcedLevel, 42);
    });
});

test('scanner can resume an interrupted scan without duplicate evidence', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processProbotScanJob } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const messages = Array.from({ length: 105 }, (_, index) => fakeMessage(`m${index}`, index + 1, {
            level: index + 1,
            userId: '100000000000000001',
        }));
        const failingChannel = fakeChannel('channel', guild, messages, { failFromCall: 2 });
        guild.channels.cache.set('channel', failingChannel);
        const created = await store.createLevelProbotScanJob({
            guildId: 'guild',
            sourceChannelId: 'channel',
            sourceChannelIds: ['channel'],
            probotAuthorId: '282859044593598464',
        });

        const failed = await processProbotScanJob(fakeClient(guild), created.job.id);
        assert.equal(failed.status, 'failed');
        assert.equal((await store.listLevelProbotAnnouncements('guild', { statuses: ['verified', 'repeated_verified'], limit: 200 })).length, 100);

        const resumedChannel = fakeChannel('channel', guild, messages);
        guild.channels.cache.set('channel', resumedChannel);
        await store.updateLevelProbotScanJob(created.job.id, { status: 'queued', errors: [] });
        const resumed = await processProbotScanJob(fakeClient(guild), created.job.id);
        const stored = await store.listLevelProbotAnnouncements('guild', { statuses: ['verified', 'repeated_verified'], limit: 200 });

        assert.equal(resumed.status, 'completed');
        assert.equal(stored.length, 105);
    });
});

test('scanner rejects missing permissions and wrong guild channels', async () => {
    await withIsolatedStore(async () => {
        const { startProbotScan } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const hidden = fakeChannel('hidden', guild, [], { canRead: false });
        guild.channels.cache.set(hidden.id, hidden);
        await assert.rejects(() => startProbotScan(fakeClient(guild), guild, { sourceChannelId: 'hidden' }), /Missing View Channel/);

        const otherGuild = fakeGuild([], { guildId: 'other' });
        const wrong = fakeChannel('wrong', otherGuild, []);
        guild.channels.cache.set(wrong.id, wrong);
        await assert.rejects(() => startProbotScan(fakeClient(guild), guild, { sourceChannelId: 'wrong' }), /does not belong/);
    });
});

test('scanner cancellation is persisted and does not mutate live XP', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { processProbotScanJob } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const messages = [fakeMessage('m1', 1, { level: 5, userId: '100000000000000001' })];
        const channel = fakeChannel('channel', guild, messages);
        guild.channels.cache.set(channel.id, channel);
        const created = await store.createLevelProbotScanJob({
            guildId: 'guild',
            sourceChannelId: 'channel',
            sourceChannelIds: ['channel'],
            probotAuthorId: '282859044593598464',
        });
        await store.requestCancelLevelProbotScanJob(created.job.id);

        const job = await processProbotScanJob(fakeClient(guild), created.job.id);

        assert.equal(job.status, 'cancelled');
        assert.equal(await store.getUserLevelRecord('guild', '100000000000000001'), null);
    });
});

test('combined preview reconciles role, announcement, reconstruction, and current XP separately', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { buildProtectedRecords } = require('../utils/levelingCalibration');
        await store.insertLevelProbotAnnouncement({
            guildId: 'guild',
            sourceChannelId: 'channel',
            messageId: 'message',
            probotAuthorId: '282859044593598464',
            targetUserId: 'user',
            announcedLevel: 30,
            announcementTimestamp: 1,
            parserVersion: 'test',
            parseStatus: 'verified',
            confidence: 'high',
            diagnostic: {},
        });
        const [announcement] = await store.listHighestProbotAnnouncementLevels('guild');
        const evidence = new Map([['user', {
            userId: 'user',
            roleMinLevel: 10,
            announcementMinLevel: announcement.announcementLevel,
        }]]);
        const simulation = {
            profile: { settings: { progressionFormula: 'legacy', xpPerLevelBase: 100 } },
            recordsByUser: new Map([['user', {
                userId: 'user',
                reconstructedLevel: 12,
                reconstructedXp: 7800,
            }]]),
            records: [],
        };

        const [record] = buildProtectedRecords(simulation, evidence);

        assert.equal(record.roleMinLevel, 10);
        assert.equal(record.announcementMinLevel, 30);
        assert.equal(record.confirmedMinimumLevel, 30);
        assert.equal(record.protectedLevel, 30);
        assert.ok(record.confirmedMinimumXp > record.reconstructedXp);
        assert.ok(record.confidenceWarnings.includes('announcement_exceeds_surviving_message_reconstruction'));
    });
});

test('starting ProBot scan returns before background processing finishes', async () => {
    await withIsolatedStore(async ({ store }) => {
        const { startProbotScan } = require('../utils/probotRecovery');
        const guild = fakeGuild([], { guildId: 'guild' });
        const messages = [fakeMessage('m1', 1, { level: 1, userId: '100000000000000001' })];
        const channel = fakeChannel('channel', guild, messages);
        guild.channels.cache.set(channel.id, channel);

        const started = await startProbotScan(fakeClient(guild), guild, { sourceChannelId: 'channel' });
        const queued = await store.getLevelProbotScanJob(started.job.id);

        assert.equal(started.ok, true);
        assert.equal(queued.status, 'queued');
    });
});
