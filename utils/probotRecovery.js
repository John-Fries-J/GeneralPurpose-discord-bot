const { setTimeout: delay, setImmediate: yieldImmediate } = require('node:timers/promises');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
    createLevelProbotScanJob,
    getLevelProbotScanJob,
    insertLevelProbotAnnouncement,
    listLevelProbotScanCheckpoints,
    listLevelProbotScanJobs,
    requestCancelLevelProbotScanJob,
    summarizeProbotAnnouncementEvidence,
    updateLevelProbotScanJob,
    upsertLevelProbotScanCheckpoint,
} = require('./store');
const {
    DEFAULT_PROBOT_AUTHOR_ID,
    DEFAULT_PROBOT_SOURCE_CHANNEL_ID,
    parseProBotLevelAnnouncement,
} = require('./probotLevelParser');

const activeScans = new Map();
const sourceChannelTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
]);

function compactError(error) {
    return error?.message || String(error || 'Unknown error');
}

function toIdList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return [...String(value).matchAll(/\d{15,25}/g)].map(match => match[0]);
}

function uniqueIds(ids = []) {
    return [...new Set(ids.map(String).filter(Boolean))];
}

function canReadHistory(channel, guild) {
    if (!channel?.messages?.fetch) return false;
    const permissions = channel.permissionsFor?.(guild.members?.me);
    if (!permissions?.has) return true;
    return permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory);
}

function describeChannel(channel) {
    return {
        id: channel?.id || null,
        name: channel?.name || channel?.id || null,
        parentId: channel?.parentId || null,
        type: channel?.type ?? null,
    };
}

function isGuildChannel(channel, guildId) {
    return String(channel?.guildId || channel?.guild?.id || '') === String(guildId);
}

async function resolveScanChannel(guild, channelId) {
    const cached = guild.channels?.cache?.get?.(channelId) || null;
    const channel = cached || await guild.channels?.fetch?.(channelId).catch(() => null);
    if (!channel) throw new Error(`Channel ${channelId} could not be fetched.`);
    if (!isGuildChannel(channel, guild.id)) throw new Error(`Channel ${channelId} does not belong to guild ${guild.id}.`);
    if (!sourceChannelTypes.has(channel.type)) throw new Error(`Channel ${channelId} is not a supported text channel or thread.`);
    if (!canReadHistory(channel, guild)) throw new Error(`Missing View Channel or Read Message History for ${channelId}.`);
    return channel;
}

function mergeScanBounds(current, timestamps = []) {
    const valid = timestamps.map(Number).filter(value => Number.isFinite(value) && value > 0);
    if (!valid.length) return current;
    const oldest = Math.min(...valid);
    const newest = Math.max(...valid);
    return {
        oldestScannedAt: current.oldestScannedAt ? Math.min(Number(current.oldestScannedAt), oldest) : oldest,
        newestScannedAt: current.newestScannedAt ? Math.max(Number(current.newestScannedAt), newest) : newest,
    };
}

async function fetchMessagePage(channel, beforeMessageId, attempts = 3) {
    const options = { limit: 100 };
    if (beforeMessageId) options.before = beforeMessageId;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const page = await channel.messages.fetch(options);
            return [...page.values()].sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
        } catch (error) {
            lastError = error;
            if (attempt >= attempts) break;
            await delay(250 * attempt);
        }
    }
    throw lastError;
}

function statusCounters(parseStatus) {
    if (parseStatus === 'verified' || parseStatus === 'repeated_verified') {
        return { matchedCount: 1, verifiedCount: 1 };
    }
    if (parseStatus === 'unresolved_identity') {
        return { matchedCount: 1, unresolvedCount: 1 };
    }
    return { invalidCount: 1, skippedCount: 1 };
}

function addCounters(target, counters) {
    for (const [key, value] of Object.entries(counters)) {
        target[key] = Number(target[key] || 0) + Number(value || 0);
    }
}

function recordFromParse(job, channel, message, parsed) {
    return {
        guildId: job.guildId,
        sourceChannelId: channel.id,
        messageId: message.id,
        jobId: job.id,
        probotAuthorId: job.probotAuthorId,
        targetUserId: parsed.targetUserId || null,
        announcedLevel: parsed.announcedLevel,
        announcementTimestamp: Number(message.createdTimestamp || Date.now()),
        parserVersion: parsed.parserVersion,
        parseStatus: parsed.parseStatus,
        confidence: parsed.confidence,
        contentSource: parsed.contentSource,
        diagnostic: {
            ...(parsed.diagnostic || {}),
            messageId: message.id,
            channelId: channel.id,
        },
    };
}

async function scanProbotChannel(job, channel) {
    const checkpoint = (await listLevelProbotScanCheckpoints(job.id)).find(item => item.channelId === channel.id);
    if (checkpoint?.status === 'completed') {
        return { cancelled: false, skipped: true };
    }

    const totals = {
        scannedCount: checkpoint?.scannedCount || 0,
        matchedCount: checkpoint?.matchedCount || 0,
        verifiedCount: checkpoint?.verifiedCount || 0,
        unresolvedCount: checkpoint?.unresolvedCount || 0,
        invalidCount: checkpoint?.invalidCount || 0,
        skippedCount: checkpoint?.skippedCount || 0,
        duplicateCount: checkpoint?.duplicateCount || 0,
        oldestScannedAt: checkpoint?.oldestScannedAt || null,
        newestScannedAt: checkpoint?.newestScannedAt || null,
    };
    const initial = { ...totals };
    let beforeMessageId = checkpoint?.beforeMessageId || null;
    let oldestMessageId = checkpoint?.oldestMessageId || null;

    await upsertLevelProbotScanCheckpoint({
        jobId: job.id,
        guildId: job.guildId,
        channelId: channel.id,
        parentChannelId: channel.parentId || null,
        beforeMessageId,
        oldestMessageId,
        status: 'running',
        ...totals,
    });

    while (true) {
        const latestJob = await getLevelProbotScanJob(job.id);
        if (!latestJob || latestJob.cancelRequested || latestJob.status === 'cancelling') {
            return {
                cancelled: true,
                scannedCount: totals.scannedCount - initial.scannedCount,
                matchedCount: totals.matchedCount - initial.matchedCount,
                verifiedCount: totals.verifiedCount - initial.verifiedCount,
                unresolvedCount: totals.unresolvedCount - initial.unresolvedCount,
                invalidCount: totals.invalidCount - initial.invalidCount,
                skippedCount: totals.skippedCount - initial.skippedCount,
                duplicateCount: totals.duplicateCount - initial.duplicateCount,
                oldestScannedAt: totals.oldestScannedAt,
                newestScannedAt: totals.newestScannedAt,
            };
        }

        const messages = await fetchMessagePage(channel, beforeMessageId);
        if (!messages.length) break;
        const oldest = messages[0];
        const bounds = mergeScanBounds(totals, messages.map(message => message.createdTimestamp));
        totals.oldestScannedAt = bounds.oldestScannedAt;
        totals.newestScannedAt = bounds.newestScannedAt;

        for (const message of messages) {
            totals.scannedCount += 1;
            if (String(message?.author?.id || '') !== String(job.probotAuthorId)) {
                totals.skippedCount += 1;
                continue;
            }

            const parsed = parseProBotLevelAnnouncement(message, { probotAuthorId: job.probotAuthorId });
            if (parsed.parseStatus === 'non_probot_author') {
                totals.skippedCount += 1;
                continue;
            }

            const inserted = await insertLevelProbotAnnouncement(recordFromParse(job, channel, message, parsed));
            if (!inserted.inserted) totals.duplicateCount += 1;
            addCounters(totals, statusCounters(inserted.record?.parseStatus || parsed.parseStatus));
        }

        beforeMessageId = oldest.id;
        oldestMessageId = oldest.id;
        await upsertLevelProbotScanCheckpoint({
            jobId: job.id,
            guildId: job.guildId,
            channelId: channel.id,
            parentChannelId: channel.parentId || null,
            beforeMessageId,
            oldestMessageId,
            status: messages.length < 100 ? 'completed' : 'running',
            ...totals,
        });
        await yieldImmediate();
        if (messages.length < 100) break;
    }

    await upsertLevelProbotScanCheckpoint({
        jobId: job.id,
        guildId: job.guildId,
        channelId: channel.id,
        parentChannelId: channel.parentId || null,
        beforeMessageId,
        oldestMessageId,
        status: 'completed',
        ...totals,
    });

    return {
        cancelled: false,
        scannedCount: totals.scannedCount - initial.scannedCount,
        matchedCount: totals.matchedCount - initial.matchedCount,
        verifiedCount: totals.verifiedCount - initial.verifiedCount,
        unresolvedCount: totals.unresolvedCount - initial.unresolvedCount,
        invalidCount: totals.invalidCount - initial.invalidCount,
        skippedCount: totals.skippedCount - initial.skippedCount,
        duplicateCount: totals.duplicateCount - initial.duplicateCount,
        oldestScannedAt: totals.oldestScannedAt,
        newestScannedAt: totals.newestScannedAt,
    };
}

async function processProbotScanJob(client, jobId) {
    let job = await getLevelProbotScanJob(jobId);
    if (!job || ['completed', 'cancelled', 'failed'].includes(job.status)) return job;
    if (job.cancelRequested || job.status === 'cancelling') {
        return updateLevelProbotScanJob(jobId, { status: 'cancelled', completedAt: Date.now() });
    }

    const guild = client.guilds.cache.get(job.guildId) || await client.guilds.fetch(job.guildId);
    const sourceChannelIds = uniqueIds(job.sourceChannelIds?.length ? job.sourceChannelIds : [job.sourceChannelId]);
    job = await updateLevelProbotScanJob(job.id, {
        status: 'running',
        startedAt: job.startedAt || Date.now(),
        channelsTotal: sourceChannelIds.length,
    });

    for (const channelId of sourceChannelIds) {
        job = await getLevelProbotScanJob(job.id);
        if (job.cancelRequested || job.status === 'cancelling') {
            return updateLevelProbotScanJob(job.id, { status: 'cancelled', completedAt: Date.now(), currentChannelId: null });
        }

        let channel = null;
        try {
            channel = await resolveScanChannel(guild, channelId);
            await updateLevelProbotScanJob(job.id, { currentChannelId: channel.id });
            const result = await scanProbotChannel(job, channel);
            if (result.cancelled) {
                return updateLevelProbotScanJob(job.id, { status: 'cancelled', completedAt: Date.now(), currentChannelId: null });
            }

            job = await getLevelProbotScanJob(job.id);
            const bounds = mergeScanBounds(job, [result.oldestScannedAt, result.newestScannedAt]);
            await updateLevelProbotScanJob(job.id, {
                channelsScanned: Number(job.channelsScanned || 0) + (result.skipped ? 0 : 1),
                scannedCount: Number(job.scannedCount || 0) + Number(result.scannedCount || 0),
                matchedCount: Number(job.matchedCount || 0) + Number(result.matchedCount || 0),
                verifiedCount: Number(job.verifiedCount || 0) + Number(result.verifiedCount || 0),
                unresolvedCount: Number(job.unresolvedCount || 0) + Number(result.unresolvedCount || 0),
                invalidCount: Number(job.invalidCount || 0) + Number(result.invalidCount || 0),
                skippedCount: Number(job.skippedCount || 0) + Number(result.skippedCount || 0),
                duplicateCount: Number(job.duplicateCount || 0) + Number(result.duplicateCount || 0),
                oldestScannedAt: bounds.oldestScannedAt,
                newestScannedAt: bounds.newestScannedAt,
            });
        } catch (error) {
            job = await getLevelProbotScanJob(job.id);
            const errors = [...(job.errors || []), {
                channel: channel ? describeChannel(channel) : { id: channelId },
                error: compactError(error),
                at: Date.now(),
            }].slice(-25);
            await upsertLevelProbotScanCheckpoint({
                jobId: job.id,
                guildId: job.guildId,
                channelId,
                parentChannelId: channel?.parentId || null,
                status: 'failed',
                error: compactError(error),
            });
            await updateLevelProbotScanJob(job.id, {
                channelsScanned: Number(job.channelsScanned || 0) + 1,
                errors,
            });
        }
    }

    job = await getLevelProbotScanJob(job.id);
    if ((job.errors || []).length) {
        return updateLevelProbotScanJob(job.id, {
            status: 'failed',
            completedAt: Date.now(),
            currentChannelId: null,
            result: {
                incomplete: true,
                reason: 'one_or_more_selected_sources_failed',
                summary: await summarizeProbotAnnouncementEvidence(job.guildId),
            },
        });
    }

    return updateLevelProbotScanJob(job.id, {
        status: 'completed',
        completedAt: Date.now(),
        currentChannelId: null,
        result: {
            incomplete: false,
            summary: await summarizeProbotAnnouncementEvidence(job.guildId),
        },
    });
}

function runProbotScanJob(client, jobId) {
    if (activeScans.has(jobId)) return false;
    const promise = yieldImmediate()
        .then(() => processProbotScanJob(client, jobId))
        .catch(async error => {
            const job = await getLevelProbotScanJob(jobId).catch(() => null);
            if (job) {
                const errors = [...(job.errors || []), { at: Date.now(), error: compactError(error) }].slice(-25);
                await updateLevelProbotScanJob(jobId, {
                    status: 'failed',
                    completedAt: Date.now(),
                    currentChannelId: null,
                    errors,
                }).catch(() => null);
            }
        })
        .finally(() => {
            activeScans.delete(jobId);
        });
    activeScans.set(jobId, promise);
    return true;
}

async function startProbotScan(client, guild, options = {}) {
    const sourceChannelId = String(options.sourceChannelId || DEFAULT_PROBOT_SOURCE_CHANNEL_ID);
    const probotAuthorId = String(options.probotAuthorId || DEFAULT_PROBOT_AUTHOR_ID);
    const sourceChannelIds = uniqueIds([
        sourceChannelId,
        ...toIdList(options.additionalChannelIds || options.additionalChannels || []),
    ]);

    for (const channelId of sourceChannelIds) {
        await resolveScanChannel(guild, channelId);
    }

    const created = await createLevelProbotScanJob({
        guildId: guild.id,
        sourceChannelId,
        sourceChannelIds,
        probotAuthorId,
        createdBy: options.createdBy || null,
        result: {
            note: 'Read-only scan of explicitly selected ProBot announcement channels.',
            source: 'probot_level_announcements',
        },
    });
    if (created.ok) runProbotScanJob(client, created.job.id);
    return created;
}

async function resumeProbotScanJobs(client) {
    const jobs = await listLevelProbotScanJobs(null, { statuses: ['queued', 'running', 'cancelling'], limit: 100 });
    for (const job of jobs) {
        if (job.cancelRequested || job.status === 'cancelling') {
            await updateLevelProbotScanJob(job.id, { status: 'cancelled', completedAt: Date.now(), currentChannelId: null });
        } else {
            await updateLevelProbotScanJob(job.id, { status: 'queued' });
            runProbotScanJob(client, job.id);
        }
    }
    return jobs.length;
}

async function cancelProbotScan(jobId) {
    return requestCancelLevelProbotScanJob(jobId);
}

async function getProbotScanStatus(jobId) {
    const job = await getLevelProbotScanJob(jobId);
    if (!job) return null;
    const checkpoints = await listLevelProbotScanCheckpoints(job.id);
    return { job, checkpoints };
}

async function latestProbotScanJob(guildId) {
    return (await listLevelProbotScanJobs(guildId, { limit: 1 }))[0] || null;
}

module.exports = {
    DEFAULT_PROBOT_AUTHOR_ID,
    DEFAULT_PROBOT_SOURCE_CHANNEL_ID,
    cancelProbotScan,
    getProbotScanStatus,
    latestProbotScanJob,
    processProbotScanJob,
    resumeProbotScanJobs,
    runProbotScanJob,
    startProbotScan,
    toIdList,
};
