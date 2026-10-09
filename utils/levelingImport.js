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
    listLevelImportMessages,
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
            if (message.author.bot) continue;
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

function calculateMessageEstimates(messages, settings) {
    const cooldownMs = Math.max(0, Number(settings.cooldownSeconds || 0) * 1000);
    const lastAwardedAt = new Map();
    const estimates = new Map();

    for (const message of messages.filter(item => item.eligible)) {
        const previousAt = lastAwardedAt.get(message.userId);
        if (previousAt !== undefined && cooldownMs && message.createdAt - previousAt < cooldownMs) continue;
        lastAwardedAt.set(message.userId, message.createdAt);
        const current = estimates.get(message.userId) || {
            userId: message.userId,
            userTag: message.userTag,
            xp: 0,
            messages: 0,
            messageIds: [],
        };
        current.userTag = message.userTag || current.userTag;
        current.xp += Number(message.xpAmount || 0);
        current.messages += 1;
        current.messageIds.push(message.messageId);
        estimates.set(message.userId, current);
    }

    return estimates;
}

async function fetchMembersForRoleRecovery(guild, targetUserId = null) {
    if (targetUserId) {
        const member = await guild.members.fetch(targetUserId).catch(() => guild.members.cache.get(targetUserId) || null);
        return member ? [member] : [];
    }

    await guild.members.fetch().catch(() => null);
    return [...guild.members.cache.values()];
}

async function buildRoleEstimates(guild, mappings, targetUserId = null) {
    if (!mappings.length) return new Map();
    const members = await fetchMembersForRoleRecovery(guild, targetUserId);
    const estimates = new Map();
    for (const member of members) {
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
    return estimates;
}

async function reconcileImport(job, guild, settings) {
    const messages = await listLevelImportMessages(job.id, { limit: 100000 });
    const messageEstimates = calculateMessageEstimates(messages, settings);
    const mappings = job.profile.includeRoleRecovery ? await listLevelRoleMappings(job.guildId) : [];
    const roleEstimates = await buildRoleEstimates(guild, mappings, job.targetUserId);
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
        for (const message of messages.filter(item => item.eligible)) {
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
        }

        if (settings.roleSync.applyDuringMigration && !settings.roleSync.dryRun) {
            for (const record of records) {
                const member = roleEstimates.get(record.userId)?.member
                    || await guild.members.fetch(record.userId).catch(() => null);
                const levelRecord = await getUserLevelRecord(job.guildId, record.userId);
                if (member && levelRecord) {
                    await syncRewardRoles(member, levelRecord, settings, {
                        awardMissingRoles: settings.roleSync.awardMissingRoles,
                        removeObsoleteRoles: settings.roleSync.removeObsoleteRoles,
                        dryRun: false,
                    });
                }
            }
        }
    }

    return {
        messagesStored: messages.length,
        usersReconciled: records.length,
        xpEstimated,
        xpApplied,
        roleMappings: mappings.length,
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

async function processLevelImportJob(client, jobId) {
    let job = await getLevelImportJob(jobId);
    if (!job || ['completed', 'cancelled', 'failed'].includes(job.status)) return job;

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
    const result = await reconcileImport(job, guild, settings);
    return updateLevelImportJob(job.id, {
        status: 'completed',
        completedAt: Date.now(),
        currentChannelId: null,
        membersSeen: result.usersReconciled,
        xpEstimated: result.xpEstimated,
        xpApplied: result.xpApplied,
        result,
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
    const roleEstimates = await buildRoleEstimates(guild, mappings, options.targetUserId || null);
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
        records: records.sort((a, b) => b.finalXp - a.finalXp),
    };
}

module.exports = {
    calculateMessageEstimates,
    cancelLevelImport,
    collectImportChannels,
    getLevelImportStatus,
    previewRoleRecovery,
    processLevelImportJob,
    resumeLevelImportJobs,
    runLevelImportJob,
    startLevelImport,
};
