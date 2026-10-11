const { setTimeout: delay } = require('node:timers/promises');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
    countProcessedLevelMessage,
    createLevelImportJob,
    getLevelImportJob,
    getUserLevelRecord,
    insertLevelImportMessage,
    insertLevelReconciliationRecord,
    listLevelImportCheckpoints,
    listLevelImportJobs,
    listLevelImportMessagesPage,
    listLevelRoleMappings,
    markLevelImportMessageProcessed,
    requestCancelLevelImportJob,
    setUserXpMinimum,
    updateLevelImportJob,
    upsertLevelImportCheckpoint,
} = require('./store');
const {
    deterministicHistoricalXp,
    getGuildLevelingConfig,
    getLevelProgress,
    getLevelingConfig,
    getTotalXp,
    getXpForLevel,
    hashProfile,
    historicalProfileFromSettings,
    inferLevelFromRoles,
    isIgnoredForXp,
    reconcileLevelEstimates,
    syncRewardRoles,
} = require('./leveling');

const importJobs = new Map();
const textChannelTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
]);
const threadContainerTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
]);

function compactError(error) {
    return error?.message || String(error || 'Unknown error');
}

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integerOption(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    return Math.max(min, Math.min(max, Math.floor(finiteNumber(value, fallback))));
}

function guildMemberCount(guild) {
    return integerOption(guild?.memberCount, 0);
}

function cachedGuildMembers(guild) {
    return [...(guild?.members?.cache?.values?.() || [])];
}

function fetchedGuildMembers(fetched, guild) {
    const values = fetched?.values?.();
    if (values) return [...values];
    return cachedGuildMembers(guild);
}

function isCompleteCachedMemberList(guild) {
    const expected = guildMemberCount(guild);
    return expected > 0 && cachedGuildMembers(guild).length >= expected;
}

function memberFetchResult({ complete, members, error = null, source = 'unknown', expectedMembers = 0, fetchAttempts = 0, retryDelaysMs = [], errors = [] }) {
    return {
        complete,
        members,
        error,
        source,
        expectedMembers,
        membersFetched: members.length,
        fetchAttempts,
        retryDelaysMs,
        errors,
    };
}

function retryAfterMsFromError(error) {
    const gatewayRetryAfter = finiteNumber(error?.data?.retry_after, NaN);
    if (Number.isFinite(gatewayRetryAfter)) return Math.max(0, Math.ceil(gatewayRetryAfter * 1000));

    const restRetryAfter = finiteNumber(error?.retryAfter, NaN);
    if (Number.isFinite(restRetryAfter)) return Math.max(0, Math.ceil(restRetryAfter));

    const match = compactError(error).match(/retry after\s+([\d.]+)\s+seconds/i);
    if (!match) return null;
    return Math.max(0, Math.ceil(Number(match[1]) * 1000));
}

function memberFetchRetryDelayMs(error, attempt, options = {}) {
    const maxRetryDelayMs = integerOption(options.maxRetryDelayMs, 60_000, { min: 0 });
    const minRetryDelayMs = integerOption(options.minRetryDelayMs, 1_000, { min: 0 });
    const rateLimitBufferMs = integerOption(options.rateLimitBufferMs, 250, { min: 0 });
    const retryAfterMs = retryAfterMsFromError(error);
    if (retryAfterMs !== null) {
        const delayMs = retryAfterMs + rateLimitBufferMs;
        return delayMs <= maxRetryDelayMs ? Math.max(minRetryDelayMs, delayMs) : null;
    }
    return Math.min(maxRetryDelayMs, Math.max(minRetryDelayMs, minRetryDelayMs * (2 ** attempt)));
}

async function waitForMemberFetchRetry(delayMs, options = {}) {
    if (delayMs <= 0) return;
    if (typeof options.delay === 'function') {
        await options.delay(delayMs);
        return;
    }
    await delay(delayMs);
}

async function fetchSingleMemberForRoleRecovery(guild, userId, options = {}) {
    const cached = guild.members.cache.get(String(userId));
    if (cached && options.preferCache !== false) {
        return { member: cached, source: 'cache', fetchAttempts: 0, errors: [], retryDelaysMs: [] };
    }

    const maxRetries = integerOption(options.maxRetries, 2, { min: 0, max: 5 });
    const errors = [];
    const retryDelaysMs = [];
    let fetchAttempts = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        fetchAttempts += 1;
        try {
            const member = await guild.members.fetch(String(userId));
            return { member, source: 'fetch', fetchAttempts, errors, retryDelaysMs };
        } catch (error) {
            errors.push(compactError(error));
            const fallback = guild.members.cache.get(String(userId));
            if (fallback && options.preferCache !== false) {
                return { member: fallback, source: 'cache_after_fetch_error', fetchAttempts, errors, retryDelaysMs };
            }
            if (attempt >= maxRetries) break;
            const delayMs = memberFetchRetryDelayMs(error, attempt, options);
            if (delayMs === null) break;
            retryDelaysMs.push(delayMs);
            await waitForMemberFetchRetry(delayMs, options);
        }
    }

    return {
        member: null,
        source: 'missing',
        fetchAttempts,
        errors,
        retryDelaysMs,
    };
}

async function fetchAllMembersForRoleRecovery(guild, options = {}) {
    const expectedMembers = guildMemberCount(guild);
    if (isCompleteCachedMemberList(guild) && options.preferCache !== false) {
        return memberFetchResult({
            complete: true,
            members: cachedGuildMembers(guild),
            source: 'cache_complete',
            expectedMembers,
        });
    }

    if (typeof guild?.members?.fetch !== 'function') {
        const members = cachedGuildMembers(guild);
        const complete = expectedMembers > 0 && members.length >= expectedMembers;
        return memberFetchResult({
            complete,
            members,
            source: complete ? 'cache_complete' : 'cache_partial',
            expectedMembers,
            error: complete ? null : 'Guild member fetch is unavailable and the member cache is incomplete.',
        });
    }

    const maxRetries = integerOption(options.maxRetries, 2, { min: 0, max: 5 });
    const errors = [];
    const retryDelaysMs = [];
    let fetchAttempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        fetchAttempts += 1;
        try {
            const fetched = await guild.members.fetch();
            const members = fetchedGuildMembers(fetched, guild);
            const complete = expectedMembers <= 0 || members.length >= expectedMembers;
            return memberFetchResult({
                complete,
                members,
                source: 'gateway_fetch',
                expectedMembers,
                fetchAttempts,
                retryDelaysMs,
                errors,
                error: complete ? null : `Fetched ${members.length} of ${expectedMembers} guild members.`,
            });
        } catch (error) {
            errors.push(compactError(error));
            if (isCompleteCachedMemberList(guild) && options.preferCache !== false) {
                return memberFetchResult({
                    complete: true,
                    members: cachedGuildMembers(guild),
                    source: 'cache_complete_after_fetch_error',
                    expectedMembers,
                    fetchAttempts,
                    retryDelaysMs,
                    errors,
                });
            }
            if (attempt >= maxRetries) break;
            const delayMs = memberFetchRetryDelayMs(error, attempt, options);
            if (delayMs === null) break;
            retryDelaysMs.push(delayMs);
            await waitForMemberFetchRetry(delayMs, options);
        }
    }

    const members = options.usePartialCache === false ? [] : cachedGuildMembers(guild);
    const lastError = errors[errors.length - 1] || 'Unknown member fetch failure.';
    return memberFetchResult({
        complete: false,
        members,
        source: members.length ? 'cache_partial_after_fetch_error' : 'fetch_failed',
        expectedMembers,
        fetchAttempts,
        retryDelaysMs,
        errors,
        error: `Guild member fetch failed after ${fetchAttempts} attempt${fetchAttempts === 1 ? '' : 's'}: ${lastError}`,
    });
}

function canReadHistory(channel, guild) {
    if (!channel?.messages?.fetch) return false;
    const permissions = channel.permissionsFor?.(guild.members.me);
    if (!permissions?.has) return true;
    return permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory);
}

function describeChannel(channel) {
    return {
        id: channel.id,
        name: channel.name || channel.id,
        parentId: channel.parentId || null,
        type: channel.type,
    };
}

async function fetchThreadPage(channel, type) {
    if (!channel.threads?.fetchArchived) return [];
    try {
        const archived = await channel.threads.fetchArchived({ type, limit: 100 });
        return [...(archived?.threads?.values?.() || [])];
    } catch {
        return [];
    }
}

async function collectImportChannels(guild, settings) {
    await guild.channels.fetch?.().catch(() => null);
    const channels = [...guild.channels.cache.values()];
    const importable = [];
    const skipped = [];

    for (const channel of channels) {
        if (textChannelTypes.has(channel.type) && canReadHistory(channel, guild)) {
            if (settings.ignoredChannelIds.includes(String(channel.id))) {
                skipped.push({ channelId: channel.id, name: channel.name, reason: 'ignored_channel' });
            } else {
                importable.push(channel);
            }
        } else if (textChannelTypes.has(channel.type)) {
            skipped.push({ channelId: channel.id, name: channel.name, reason: 'missing_view_or_history_permission' });
        }

        if (!threadContainerTypes.has(channel.type) || !channel.threads) continue;
        const active = await channel.threads.fetchActive?.().catch(() => null);
        const threads = [
            ...(active?.threads?.values?.() || []),
            ...await fetchThreadPage(channel, 'public'),
            ...await fetchThreadPage(channel, 'private'),
            ...(channel.threads.cache?.values?.() || []),
        ];
        const seen = new Set(importable.map(item => item.id));
        for (const thread of threads) {
            if (!thread?.id || seen.has(thread.id)) continue;
            seen.add(thread.id);
            if (!canReadHistory(thread, guild)) {
                skipped.push({ channelId: thread.id, name: thread.name, parentId: channel.id, reason: 'missing_view_or_history_permission' });
            } else if (settings.ignoredChannelIds.includes(String(thread.id)) || settings.ignoredChannelIds.includes(String(channel.id))) {
                skipped.push({ channelId: thread.id, name: thread.name, parentId: channel.id, reason: 'ignored_channel' });
            } else {
                importable.push(thread);
            }
        }
    }

    return { channels: importable, skipped };
}

function buildImportProfile(settings, options = {}) {
    return {
        ...historicalProfileFromSettings(settings),
        includeRoleRecovery: options.includeRoleRecovery === true,
        reconciliationPolicy: options.policy || 'max',
        allowIncompleteApply: options.allowIncompleteApply === true,
        version: 1,
    };
}

function settingsFromJobProfile(currentSettings, profile) {
    return getLevelingConfig({
        leveling: {
            ...currentSettings,
            ...profile,
        },
    });
}

async function startLevelImport(client, guild, options = {}) {
    const currentSettings = await getGuildLevelingConfig(guild.id);
    const profile = buildImportProfile(currentSettings, options);
    const profileHash = hashProfile(profile);
    const created = await createLevelImportJob({
        guildId: guild.id,
        targetUserId: options.targetUserId || null,
        dryRun: options.dryRun !== false,
        profileHash,
        profile,
        createdBy: options.createdBy || null,
        provenance: {
            source: 'discord_message_history',
            note: 'Estimated from messages accessible to the bot at scan time. Deleted and inaccessible messages are not counted.',
            createdAt: Date.now(),
        },
    });

    if (created.ok) runLevelImportJob(client, created.job.id);
    return created;
}

function runLevelImportJob(client, jobId) {
    if (importJobs.has(jobId)) return false;
    const promise = processLevelImportJob(client, jobId)
        .catch(async error => {
            const job = await getLevelImportJob(jobId).catch(() => null);
            if (job) {
                const errors = [...(job.errors || []), { at: Date.now(), error: compactError(error) }].slice(-25);
                await updateLevelImportJob(jobId, {
                    status: 'failed',
                    errors,
                    completedAt: Date.now(),
                }).catch(() => null);
            }
        })
        .finally(() => {
            importJobs.delete(jobId);
        });
    importJobs.set(jobId, promise);
    return true;
}

async function fetchMessagePage(channel, beforeMessageId) {
    const options = { limit: 100 };
    if (beforeMessageId) options.before = beforeMessageId;
    const page = await channel.messages.fetch(options);
    return [...page.values()].sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
}

function userTagFromMessage(message) {
    return message.author?.tag || message.author?.username || message.author?.id || null;
}

async function scanChannelMessages(job, channel, settings) {
    const checkpoint = (await listLevelImportCheckpoints(job.id)).find(item => item.channelId === channel.id);
    if (checkpoint?.status === 'completed') {
        return { cancelled: false, messagesSeen: 0, messagesEligible: 0, skipped: true };
    }
    let beforeMessageId = checkpoint?.beforeMessageId || null;
    let messagesSeen = checkpoint?.messagesSeen || 0;
    let messagesEligible = checkpoint?.messagesEligible || 0;
    const initialMessagesSeen = messagesSeen;
    const initialMessagesEligible = messagesEligible;
    let oldestMessageId = checkpoint?.oldestMessageId || null;

    await upsertLevelImportCheckpoint({
        jobId: job.id,
        guildId: job.guildId,
        channelId: channel.id,
        parentChannelId: channel.parentId || null,
        beforeMessageId,
        oldestMessageId,
        status: 'running',
        messagesSeen,
        messagesEligible,
    });

    while (true) {
        const latestJob = await getLevelImportJob(job.id);
        if (!latestJob || latestJob.cancelRequested) {
            return {
                cancelled: true,
                messagesSeen: messagesSeen - initialMessagesSeen,
                messagesEligible: messagesEligible - initialMessagesEligible,
            };
        }

        const messages = await fetchMessagePage(channel, beforeMessageId);
        if (!messages.length) break;
        const oldest = messages[0];

        for (const message of messages) {
            messagesSeen += 1;
            if (!message?.id || !message.author?.id) continue;
            if (message.author.bot || message.webhookId) continue;
            if (job.targetUserId && message.author.id !== job.targetUserId) continue;
            const member = message.member || message.guild?.members?.cache?.get?.(message.author.id) || null;
            if (isIgnoredForXp(member, channel.id, settings, message.author.id)) continue;
            if (await countProcessedLevelMessage(job.guildId, message.id, job.profileHash)) continue;

            const xpAmount = deterministicHistoricalXp(job.guildId, message.id, job.profile);
            const inserted = await insertLevelImportMessage({
                jobId: job.id,
                guildId: job.guildId,
                messageId: message.id,
                userId: message.author.id,
                userTag: userTagFromMessage(message),
                channelId: channel.id,
                createdAt: Number(message.createdTimestamp || Date.now()),
                xpAmount,
                eligible: true,
            });
            if (inserted) messagesEligible += 1;
        }

        beforeMessageId = oldest.id;
        oldestMessageId = oldest.id;
        await upsertLevelImportCheckpoint({
            jobId: job.id,
            guildId: job.guildId,
            channelId: channel.id,
            parentChannelId: channel.parentId || null,
            beforeMessageId,
            oldestMessageId,
            status: messages.length < 100 ? 'completed' : 'running',
            messagesSeen,
            messagesEligible,
        });
        if (messages.length < 100) break;
    }

    await upsertLevelImportCheckpoint({
        jobId: job.id,
        guildId: job.guildId,
        channelId: channel.id,
        parentChannelId: channel.parentId || null,
        beforeMessageId,
        oldestMessageId,
        status: 'completed',
        messagesSeen,
        messagesEligible,
    });

    return {
        cancelled: false,
        messagesSeen: messagesSeen - initialMessagesSeen,
        messagesEligible: messagesEligible - initialMessagesEligible,
    };
}

function orderedMessages(messages = []) {
    return [...messages].sort((a, b) => {
        return Number(a.createdAt || 0) - Number(b.createdAt || 0)
            || String(a.messageId).localeCompare(String(b.messageId));
    });
}

function addMessageEstimate(message, settings, state, options = {}) {
    if (!message.eligible) return false;
    const cooldownMs = Math.max(0, Number(settings.cooldownSeconds || 0) * 1000);
    const previousAt = state.lastAwardedAt.get(message.userId);
    if (previousAt !== undefined && cooldownMs && Number(message.createdAt || 0) - previousAt < cooldownMs) return false;
    state.lastAwardedAt.set(message.userId, Number(message.createdAt || 0));
    const current = state.estimates.get(message.userId) || {
        userId: message.userId,
        userTag: message.userTag,
        xp: 0,
        messages: 0,
        messageIds: options.trackMessageIds === false ? undefined : [],
    };
    current.userTag = message.userTag || current.userTag;
    current.xp += Number(message.xpAmount || 0);
    current.messages += 1;
    if (current.messageIds) current.messageIds.push(message.messageId);
    state.estimates.set(message.userId, current);
    return true;
}

function calculateMessageEstimates(messages, settings, options = {}) {
    const state = {
        lastAwardedAt: new Map(),
        estimates: new Map(),
    };

    for (const message of orderedMessages(messages)) {
        addMessageEstimate(message, settings, state, options);
    }

    return state.estimates;
}

async function forEachImportMessage(jobId, callback, options = {}) {
    const requestedPageSize = Number(options.pageSize || 1000);
    const pageSize = Number.isFinite(requestedPageSize) ? Math.max(1, Math.min(10000, Math.floor(requestedPageSize))) : 1000;
    let afterCreatedAt = null;
    let afterMessageId = '';
    let count = 0;

    while (true) {
        const page = await listLevelImportMessagesPage(jobId, {
            limit: pageSize,
            afterCreatedAt,
            afterMessageId,
            userId: options.userId || null,
        });
        if (!page.length) break;
        for (const message of page) {
            await callback(message);
            count += 1;
        }
        const last = page[page.length - 1];
        afterCreatedAt = Number(last.createdAt || 0);
        afterMessageId = last.messageId;
    }

    return count;
}

async function calculateStoredMessageEstimates(jobId, settings) {
    const cooldownMs = Math.max(0, Number(settings.cooldownSeconds || 0) * 1000);
    const state = {
        lastAwardedAt: new Map(),
        estimates: new Map(),
    };
    let eligibleStored = 0;
    let awardedMessages = 0;

    await forEachImportMessage(jobId, message => {
        if (message.eligible) eligibleStored += 1;
        if (addMessageEstimate(message, { ...settings, cooldownSeconds: cooldownMs / 1000 }, state, { trackMessageIds: false })) {
            awardedMessages += 1;
        }
    });

    return {
        estimates: state.estimates,
        eligibleStored,
        awardedMessages,
    };
}

async function fetchMembersForRoleRecovery(guild, targetUserId = null, options = {}) {
    const targetUserIds = targetUserId instanceof Set
        ? [...targetUserId].map(String)
        : (Array.isArray(targetUserId) ? targetUserId.map(String) : []);
    if (targetUserIds.length) {
        const members = [];
        const missing = [];
        const errors = [];
        const retryDelaysMs = [];
        let fetchAttempts = 0;
        const sources = new Set();
        for (const userId of targetUserIds) {
            const result = await fetchSingleMemberForRoleRecovery(guild, userId, options);
            fetchAttempts += result.fetchAttempts;
            retryDelaysMs.push(...result.retryDelaysMs);
            errors.push(...result.errors);
            sources.add(result.source);
            if (result.member) members.push(result.member);
            else missing.push(userId);
        }
        return {
            complete: missing.length === 0,
            members,
            error: missing.length ? `Target member(s) ${missing.join(', ')} could not be fetched.` : null,
            source: missing.length ? 'target_fetch_partial' : [...sources].join('+') || 'target_fetch',
            expectedMembers: targetUserIds.length,
            membersFetched: members.length,
            fetchAttempts,
            retryDelaysMs,
            errors,
        };
    }

    if (targetUserId && !(targetUserId instanceof Set) && !Array.isArray(targetUserId)) {
        const result = await fetchSingleMemberForRoleRecovery(guild, String(targetUserId), options);
        return {
            complete: Boolean(result.member),
            members: result.member ? [result.member] : [],
            error: result.member ? null : `Target member ${targetUserId} could not be fetched.`,
            source: result.source,
            expectedMembers: 1,
            membersFetched: result.member ? 1 : 0,
            fetchAttempts: result.fetchAttempts,
            retryDelaysMs: result.retryDelaysMs,
            errors: result.errors,
        };
    }

    return fetchAllMembersForRoleRecovery(guild, options);
}

async function buildRoleEstimates(guild, mappings, targetUserId = null) {
    if (!mappings.length) return { estimates: new Map(), complete: true, error: null, membersFetched: 0 };
    const fetched = await fetchMembersForRoleRecovery(guild, targetUserId);
    const estimates = new Map();
    for (const member of fetched.members) {
        if (member.user?.bot) continue;
        const roleMinLevel = inferLevelFromRoles(member, mappings);
        if (roleMinLevel <= 0) continue;
        estimates.set(member.id, {
            userId: member.id,
            userTag: member.user?.tag || member.user?.username || member.id,
            member,
            roleMinLevel,
        });
    }
    return {
        estimates,
        complete: fetched.complete,
        error: fetched.error,
        membersFetched: fetched.members.length,
    };
}

async function reconcileImport(job, guild, settings) {
    const messageResult = await calculateStoredMessageEstimates(job.id, settings);
    const messageEstimates = messageResult.estimates;
    const mappings = job.profile.includeRoleRecovery ? await listLevelRoleMappings(job.guildId) : [];
    const roleResult = await buildRoleEstimates(guild, mappings, job.targetUserId);
    const roleEstimates = roleResult.estimates;
    const incompleteWarnings = [];
    if (!roleResult.complete) {
        incompleteWarnings.push({
            type: 'role_recovery_members',
            reason: roleResult.error || 'Guild members could not be fetched completely.',
            membersFetched: roleResult.membersFetched,
        });
    }
    if (!job.dryRun && incompleteWarnings.length && job.profile.allowIncompleteApply !== true) {
        return {
            blocked: true,
            incompleteWarnings,
            roleMappings: mappings.length,
            roleMembersFetched: roleResult.membersFetched,
        };
    }
    const userIds = new Set([...messageEstimates.keys(), ...roleEstimates.keys()]);
    const records = [];
    let xpEstimated = 0;
    let xpApplied = 0;

    for (const userId of userIds) {
        const messageEstimate = messageEstimates.get(userId);
        const roleEstimate = roleEstimates.get(userId);
        const existing = await getUserLevelRecord(job.guildId, userId);
        const reconciled = reconcileLevelEstimates({
            existingXp: getTotalXp(existing),
            messageEstimatedXp: messageEstimate?.xp || 0,
            roleMinLevel: roleEstimate?.roleMinLevel || 0,
            settings,
            policy: job.profile.reconciliationPolicy || 'max',
        });
        xpEstimated += reconciled.messageEstimatedXp;

        const record = {
            jobId: job.id,
            guildId: job.guildId,
            userId,
            userTag: messageEstimate?.userTag || roleEstimate?.userTag || existing?.userTag || null,
            ...reconciled,
            dryRun: job.dryRun,
            applied: false,
            metadata: {
                messageCount: messageEstimate?.messages || 0,
                roleRecovery: Boolean(roleEstimate?.roleMinLevel),
            },
        };

        if (!job.dryRun && reconciled.finalXp > reconciled.existingXp) {
            await setUserXpMinimum({
                guildId: job.guildId,
                userId,
                userTag: record.userTag,
                minimumTotalXp: reconciled.finalXp,
                source: 'historical_import',
                sourceKey: `${job.id}:${userId}`,
                jobId: job.id,
                metadata: {
                    profileHash: job.profileHash,
                    policy: reconciled.policy,
                    estimated: true,
                },
            });
            record.applied = true;
            xpApplied += reconciled.finalXp - reconciled.existingXp;
        }

        await insertLevelReconciliationRecord(record);
        records.push(record);
    }

    if (!job.dryRun) {
        await forEachImportMessage(job.id, async message => {
            if (!message.eligible) return;
            await markLevelImportMessageProcessed({
                guildId: job.guildId,
                messageId: message.messageId,
                profileHash: job.profileHash,
                jobId: job.id,
                userId: message.userId,
                channelId: message.channelId,
                xpAmount: message.xpAmount,
                createdAt: Date.now(),
            });
        });

        if (settings.roleSync.applyDuringMigration && !settings.roleSync.dryRun) {
            const roleSync = { added: 0, removed: 0, skipped: [], errors: [] };
            for (const record of records) {
                const member = roleEstimates.get(record.userId)?.member
                    || await guild.members.fetch(record.userId).catch(() => null);
                const levelRecord = await getUserLevelRecord(job.guildId, record.userId);
                if (member && levelRecord) {
                    const result = await syncRewardRoles(member, levelRecord, settings, {
                        awardMissingRoles: settings.roleSync.awardMissingRoles,
                        removeObsoleteRoles: settings.roleSync.removeObsoleteRoles,
                        dryRun: false,
                    });
                    roleSync.added += result.added.length;
                    roleSync.removed += result.removed.length;
                    roleSync.skipped.push(...result.skipped.map(item => ({ ...item, userId: record.userId })));
                    roleSync.errors.push(...result.errors.map(item => ({ ...item, userId: record.userId })));
                }
            }
            if (roleSync.skipped.length || roleSync.errors.length) {
                incompleteWarnings.push({
                    type: 'role_sync',
                    reason: 'Some migration role-sync changes could not be applied.',
                    skipped: roleSync.skipped.slice(0, 25),
                    errors: roleSync.errors.slice(0, 25),
                });
            }
        }
    }

    return {
        messagesStored: messageResult.eligibleStored,
        messagesAwarded: messageResult.awardedMessages,
        usersReconciled: records.length,
        xpEstimated,
        xpApplied,
        roleMappings: mappings.length,
        roleMembersFetched: roleResult.membersFetched,
        incompleteWarnings,
        top: records
            .sort((a, b) => b.finalXp - a.finalXp)
            .slice(0, 10)
            .map(record => ({
                userId: record.userId,
                userTag: record.userTag,
                finalXp: record.finalXp,
                messageEstimatedXp: record.messageEstimatedXp,
                roleMinLevel: record.roleMinLevel,
                level: getLevelProgress({ textXp: record.finalXp, voiceXp: 0 }, settings).level,
            })),
    };
}

function incompleteScanWarnings(job) {
    const warnings = [];
    for (const channel of job.skippedChannels || []) {
        warnings.push({
            type: 'skipped_channel',
            channel,
            reason: channel.reason || 'skipped',
        });
    }
    for (const error of job.errors || []) {
        warnings.push({
            type: 'failed_channel_scan',
            channel: error.channel || null,
            reason: error.error || 'Channel scan failed.',
        });
    }
    return warnings;
}

function mergeResultWarnings(result, warnings) {
    return {
        ...(result || {}),
        incomplete: warnings.length > 0,
        incompleteWarnings: warnings,
        requiresConfirmation: warnings.length > 0,
    };
}

async function processLevelImportJob(client, jobId) {
    let job = await getLevelImportJob(jobId);
    if (!job || ['completed', 'cancelled', 'failed', 'needs_confirmation'].includes(job.status)) return job;

    const guild = client.guilds.cache.get(job.guildId) || await client.guilds.fetch(job.guildId);
    const currentSettings = await getGuildLevelingConfig(job.guildId);
    const settings = settingsFromJobProfile(currentSettings, job.profile);
    const collected = await collectImportChannels(guild, settings);
    job = await updateLevelImportJob(job.id, {
        status: 'running',
        startedAt: job.startedAt || Date.now(),
        channelsTotal: collected.channels.length,
        skippedChannels: collected.skipped,
    });

    for (const channel of collected.channels) {
        job = await getLevelImportJob(job.id);
        if (job.cancelRequested) {
            await updateLevelImportJob(job.id, { status: 'cancelled', completedAt: Date.now() });
            return getLevelImportJob(job.id);
        }

        try {
            await updateLevelImportJob(job.id, { currentChannelId: channel.id });
            const result = await scanChannelMessages(job, channel, settings);
            if (result.cancelled) {
                await updateLevelImportJob(job.id, { status: 'cancelled', completedAt: Date.now() });
                return getLevelImportJob(job.id);
            }
            job = await getLevelImportJob(job.id);
            await updateLevelImportJob(job.id, {
                channelsScanned: Number(job.channelsScanned || 0) + 1,
                messagesSeen: Number(job.messagesSeen || 0) + result.messagesSeen,
                messagesEligible: Number(job.messagesEligible || 0) + result.messagesEligible,
            });
        } catch (error) {
            job = await getLevelImportJob(job.id);
            const errors = [...(job.errors || []), {
                channel: describeChannel(channel),
                error: compactError(error),
                at: Date.now(),
            }].slice(-25);
            await upsertLevelImportCheckpoint({
                jobId: job.id,
                guildId: job.guildId,
                channelId: channel.id,
                parentChannelId: channel.parentId || null,
                status: 'failed',
                error: compactError(error),
            });
            await updateLevelImportJob(job.id, {
                channelsScanned: Number(job.channelsScanned || 0) + 1,
                errors,
            });
        }
    }

    job = await getLevelImportJob(job.id);
    const scanWarnings = incompleteScanWarnings(job);
    if (!job.dryRun && scanWarnings.length && job.profile.allowIncompleteApply !== true) {
        return updateLevelImportJob(job.id, {
            status: 'needs_confirmation',
            completedAt: Date.now(),
            currentChannelId: null,
            result: mergeResultWarnings({
                messagesStored: Number(job.messagesEligible || 0),
                usersReconciled: 0,
                xpEstimated: 0,
                xpApplied: 0,
            }, scanWarnings),
        });
    }

    const result = await reconcileImport(job, guild, settings);
    if (result.blocked) {
        const warnings = [...scanWarnings, ...(result.incompleteWarnings || [])];
        return updateLevelImportJob(job.id, {
            status: 'needs_confirmation',
            completedAt: Date.now(),
            currentChannelId: null,
            result: mergeResultWarnings(result, warnings),
        });
    }
    const warnings = [...scanWarnings, ...(result.incompleteWarnings || [])];
    return updateLevelImportJob(job.id, {
        status: 'completed',
        completedAt: Date.now(),
        currentChannelId: null,
        membersSeen: result.usersReconciled,
        xpEstimated: result.xpEstimated,
        xpApplied: result.xpApplied,
        result: mergeResultWarnings(result, warnings),
    });
}

async function resumeLevelImportJobs(client) {
    const jobs = await listLevelImportJobs(null, { statuses: ['queued', 'running', 'cancelling'], limit: 100 });
    for (const job of jobs) {
        if (job.cancelRequested || job.status === 'cancelling') {
            await updateLevelImportJob(job.id, { status: 'cancelled', completedAt: Date.now() });
        } else {
            await updateLevelImportJob(job.id, { status: 'queued' });
            runLevelImportJob(client, job.id);
        }
    }
    return jobs.length;
}

async function cancelLevelImport(jobId) {
    return requestCancelLevelImportJob(jobId);
}

async function getLevelImportStatus(jobId) {
    const job = await getLevelImportJob(jobId);
    if (!job) return null;
    const checkpoints = await listLevelImportCheckpoints(job.id);
    return { job, checkpoints };
}

async function previewRoleRecovery(guild, options = {}) {
    const settings = await getGuildLevelingConfig(guild.id);
    const mappings = await listLevelRoleMappings(guild.id);
    const roleResult = await buildRoleEstimates(guild, mappings, options.targetUserId || null);
    if (options.apply && !roleResult.complete) {
        return {
            mappings: mappings.length,
            membersMatched: 0,
            wouldChange: 0,
            applied: 0,
            complete: false,
            error: roleResult.error,
            records: [],
        };
    }
    const roleEstimates = roleResult.estimates;
    const records = [];

    for (const estimate of roleEstimates.values()) {
        const existing = await getUserLevelRecord(guild.id, estimate.userId);
        const roleMinXp = getXpForLevel(estimate.roleMinLevel, settings);
        const currentXp = getTotalXp(existing);
        const finalXp = Math.max(currentXp, roleMinXp);
        const record = {
            guildId: guild.id,
            userId: estimate.userId,
            userTag: estimate.userTag,
            existingXp: currentXp,
            roleMinLevel: estimate.roleMinLevel,
            roleMinXp,
            finalXp,
            wouldChange: finalXp > currentXp,
        };
        if (options.apply && record.wouldChange) {
            await setUserXpMinimum({
                guildId: guild.id,
                userId: estimate.userId,
                userTag: estimate.userTag,
                minimumTotalXp: finalXp,
                source: 'role_recovery',
                sourceKey: `role:${guild.id}:${estimate.userId}:${estimate.roleMinLevel}`,
                adminId: options.adminId || null,
                metadata: { estimated: true },
            });
        }
        records.push(record);
    }

    return {
        mappings: mappings.length,
        membersMatched: records.length,
        wouldChange: records.filter(record => record.wouldChange).length,
        applied: options.apply ? records.filter(record => record.wouldChange).length : 0,
        complete: roleResult.complete,
        error: roleResult.error,
        membersFetched: roleResult.membersFetched,
        records: records.sort((a, b) => b.finalXp - a.finalXp),
    };
}

module.exports = {
    calculateMessageEstimates,
    cancelLevelImport,
    collectImportChannels,
    fetchMembersForRoleRecovery,
    forEachImportMessage,
    getLevelImportStatus,
    incompleteScanWarnings,
    previewRoleRecovery,
    processLevelImportJob,
    resumeLevelImportJobs,
    runLevelImportJob,
    settingsFromJobProfile,
    startLevelImport,
};
