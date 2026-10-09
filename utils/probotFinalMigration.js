const {
    buildCombinedHistoricalEvidence,
    buildProtectedRecords,
    importCompleteness,
    replayImportJobProfiles,
} = require('./levelingCalibration');
const {
    getGuildLevelingConfig,
    getLevelProgress,
    getXpForLevel,
} = require('./leveling');
const {
    applyLevelProbotFinalMigration,
    getLevelImportJob,
    getLevelProbotMigrationBatch,
    getUserLevelRecord,
    listLevelImportJobs,
    listLevelProbotMigrationBatches,
    listLevelProbotMigrationSnapshots,
    listLevelXpEvents,
    rollbackLevelProbotFinalMigration,
} = require('./store');

const FINAL_PROBOT_MIGRATION_POLICY = Object.freeze({
    id: 'confirmed_minimum_plus_live_text_v1',
    historicalSource: 'verified ProBot announcement and mapped role minimums only',
    reconstructedEstimateUse: 'audit_only',
    liveXpPolicy: 'preserve current live text XP after subtracting prior historical/final migration deltas',
    voiceXpPolicy: 'preserve existing voice XP unchanged',
    rolePolicy: 'never_modify_roles',
});

const historicalTextSources = new Set(['historical_import', 'role_recovery']);

function toUserIdSet(value) {
    if (!value) return new Set();
    if (value instanceof Set) return new Set([...value].map(String).filter(Boolean));
    if (Array.isArray(value)) return new Set(value.map(String).filter(Boolean));
    return new Set([String(value)].filter(Boolean));
}

function totalXp(record) {
    return Number(record?.textXp || 0) + Number(record?.voiceXp || 0);
}

async function latestCompletedImportJob(guildId) {
    return (await listLevelImportJobs(guildId, { statuses: ['completed'], limit: 1 }))[0] || null;
}

async function resolveCompletedImportJob(guildId, importJobId = null) {
    const job = importJobId ? await getLevelImportJob(importJobId) : await latestCompletedImportJob(guildId);
    if (!job) return null;
    if (job.guildId !== guildId || job.status !== 'completed') return null;
    return job;
}

async function fetchCurrentMemberIds(guild) {
    try {
        const fetched = await guild.members.fetch();
        return {
            complete: true,
            ids: new Set([...(fetched?.keys?.() || guild.members.cache.keys())].map(String)),
            error: null,
        };
    } catch (error) {
        return {
            complete: false,
            ids: new Set([...(guild.members.cache?.keys?.() || [])].map(String)),
            error: error?.message || String(error),
        };
    }
}

async function priorHistoricalTextXp(guildId, userId) {
    const events = await listLevelXpEvents(guildId, { userId, limit: 5000 });
    return events
        .filter(event => historicalTextSources.has(event.source))
        .filter(event => Number(event.amount || 0) > 0)
        .reduce((sum, event) => sum + Number(event.amount || 0), 0);
}

async function priorFinalMigrationTextXp(guildId, userId) {
    const snapshots = await listLevelProbotMigrationSnapshots(null, { guildId, userId, limit: 100000 });
    return snapshots
        .filter(snapshot => !snapshot.rolledBackAt)
        .reduce((sum, snapshot) => sum + Number(snapshot.textDelta || 0), 0);
}

async function replayReconstruction(importJob, settings, userIds) {
    if (!importJob) {
        return {
            simulation: {
                profile: { label: 'No completed import', settings },
                records: [],
                recordsByUser: new Map(),
                awardedMessages: 0,
                xpEstimated: 0,
                usersReconstructed: 0,
                messagesVisited: 0,
            },
            completeness: {
                complete: false,
                warnings: [{ type: 'missing_completed_import', reason: 'No completed historical import job was available for reconstructed-level audit.' }],
            },
        };
    }

    const [simulation] = await replayImportJobProfiles(importJob, [{
        label: 'Current live formula',
        settings,
    }], {
        userFilter: userIds?.size ? userIds : null,
    });
    return {
        simulation,
        completeness: importCompleteness(importJob),
    };
}

function outlierWarnings(record) {
    const warnings = [];
    const reconstructed = Number(record.reconstructedLevel || 0);
    const confirmed = Number(record.confirmedMinimumLevel || 0);

    if (!confirmed && reconstructed >= 30) warnings.push('estimated_only_reconstruction_not_applied');
    if (!confirmed && reconstructed >= 75) warnings.push('extreme_reconstructed_level_unreliable');
    if (confirmed > 0 && reconstructed >= confirmed + 25) warnings.push('reconstructed_level_extreme_above_confirmed_minimum_unreliable');
    if (confirmed >= 30 && reconstructed > 0 && reconstructed + 25 < confirmed) warnings.push('surviving_history_far_below_confirmed_minimum');
    if (record.estimatedOnly) warnings.push('no_confirmed_level_evidence_not_applied');

    return warnings;
}

function summarizeRecords(records) {
    const affected = records.filter(record => record.wouldChange);
    const confirmed = records.filter(record => record.confirmedMinimumLevel > 0);
    const unreliable = records.filter(record => record.unreliableEstimate);
    return {
        recordsTotal: records.length,
        confirmedMembers: confirmed.length,
        affectedCount: affected.length,
        xpDelta: affected.reduce((sum, record) => sum + Number(record.textDelta || 0), 0),
        highestConfirmedLevel: confirmed.reduce((highest, record) => Math.max(highest, Number(record.confirmedMinimumLevel || 0)), 0),
        unreliableEstimates: unreliable.length,
        estimatedOnlyRecords: records.filter(record => record.estimatedOnly).length,
        roleEvidenceRecords: records.filter(record => record.roleMinLevel > 0).length,
        announcementEvidenceRecords: records.filter(record => record.announcementMinLevel > 0).length,
    };
}

async function buildFinalProbotMigrationPreview(guild, options = {}) {
    const settings = await getGuildLevelingConfig(guild.id);
    const requestedUserIds = toUserIdSet(options.targetUserIds || options.userIds);
    if (options.targetUserId) requestedUserIds.add(String(options.targetUserId));

    let currentMemberIds = null;
    let currentMemberFetch = { complete: true, error: null };
    if (options.currentMemberOnly === true) {
        currentMemberFetch = await fetchCurrentMemberIds(guild);
        currentMemberIds = currentMemberFetch.ids;
        if (requestedUserIds.size) {
            for (const userId of [...requestedUserIds]) {
                if (!currentMemberIds.has(userId)) requestedUserIds.delete(userId);
            }
        }
    }

    const importJob = await resolveCompletedImportJob(guild.id, options.importJobId || null);
    const evidence = await buildCombinedHistoricalEvidence(guild, settings, {
        targetUserIds: requestedUserIds.size ? requestedUserIds : null,
    });
    const replay = await replayReconstruction(importJob, settings, requestedUserIds.size ? requestedUserIds : null);

    const protectedRecords = buildProtectedRecords(replay.simulation, evidence.evidence, {
        restrictToUserIds: requestedUserIds.size ? requestedUserIds : null,
        importWarnings: replay.completeness.warnings,
        evidenceComplete: evidence.complete && currentMemberFetch.complete,
    });

    const records = [];
    for (const baseRecord of protectedRecords) {
        if (currentMemberIds && !currentMemberIds.has(String(baseRecord.userId))) continue;

        const current = await getUserLevelRecord(guild.id, baseRecord.userId);
        const currentTextXp = Number(current?.textXp || 0);
        const currentVoiceXp = Number(current?.voiceXp || 0);
        const currentStoredXp = totalXp(current);
        const currentProgress = getLevelProgress({ textXp: currentTextXp, voiceXp: currentVoiceXp }, settings);
        const priorHistorical = await priorHistoricalTextXp(guild.id, baseRecord.userId);
        const priorFinal = await priorFinalMigrationTextXp(guild.id, baseRecord.userId);
        const liveTextXp = Math.max(0, currentTextXp - priorHistorical - priorFinal);
        const confirmedLevel = Number(baseRecord.confirmedMinimumLevel || 0);
        const requiredTotalXp = confirmedLevel > 0 ? getXpForLevel(confirmedLevel, settings) : 0;
        const targetTextXp = confirmedLevel > 0
            ? Math.max(currentTextXp, requiredTotalXp + liveTextXp)
            : currentTextXp;
        const textDelta = Math.max(0, targetTextXp - currentTextXp);
        const finalProgress = getLevelProgress({ textXp: targetTextXp, voiceXp: currentVoiceXp }, settings);
        const warnings = [...new Set([...(baseRecord.confidenceWarnings || []), ...outlierWarnings(baseRecord)])];

        records.push({
            ...baseRecord,
            currentTextXp,
            currentVoiceXp,
            currentStoredXp,
            currentStoredLevel: current ? currentProgress.level : 0,
            requiredTotalXp,
            priorHistoricalTextXp: priorHistorical,
            priorFinalTextXp: priorFinal,
            liveTextXp,
            targetTextXp,
            targetVoiceXp: currentVoiceXp,
            finalTotalXp: targetTextXp + currentVoiceXp,
            finalLevel: finalProgress.level,
            textDelta,
            wouldChange: textDelta > 0 && confirmedLevel > 0,
            migrationPolicy: FINAL_PROBOT_MIGRATION_POLICY.id,
            confidenceWarnings: warnings,
            unreliableEstimate: warnings.some(warning => warning.includes('unreliable') || warning.includes('not_applied') || warning.includes('far_below')),
        });
    }

    records.sort((a, b) => {
        return Number(b.wouldChange) - Number(a.wouldChange)
            || Number(b.unreliableEstimate) - Number(a.unreliableEstimate)
            || Number(b.confirmedMinimumLevel || 0) - Number(a.confirmedMinimumLevel || 0)
            || Number(b.textDelta || 0) - Number(a.textDelta || 0)
            || String(a.userId).localeCompare(String(b.userId));
    });

    const warnings = [];
    if (!importJob) warnings.push('No completed historical import job was available; reconstructed-level outlier audit is limited.');
    if (!evidence.complete) warnings.push(evidence.error || 'Guild member role evidence was partial.');
    if (!currentMemberFetch.complete) warnings.push(`Current-member filtering used cached members after fetch failed: ${currentMemberFetch.error}`);

    return {
        guildId: guild.id,
        importJob,
        settings: {
            progressionFormula: settings.progressionFormula,
            xpPerLevelBase: settings.xpPerLevelBase,
            xpCurveFactor: settings.xpCurveFactor,
            xpProfile: settings.xpProfile,
        },
        policy: FINAL_PROBOT_MIGRATION_POLICY,
        scopedUserIds: [...requestedUserIds],
        currentMemberOnly: options.currentMemberOnly === true,
        evidence: {
            mappings: evidence.mappings.length,
            membersWithRoleEvidence: evidence.records.filter(record => Number(record.roleMinLevel || 0) > 0).length,
            membersWithAnnouncementEvidence: evidence.announcementSummary?.uniqueVerifiedMembers || 0,
            verifiedAnnouncements: evidence.announcementSummary?.verifiedAnnouncements || 0,
            unresolvedAnnouncements: evidence.announcementSummary?.unresolvedIdentities || 0,
            highestAnnouncementLevel: evidence.announcementSummary?.highestRecoveredLevel || 0,
            complete: evidence.complete,
            error: evidence.error,
        },
        replay: {
            messagesVisited: replay.simulation.messagesVisited || 0,
            usersReconstructed: replay.simulation.usersReconstructed || 0,
            reconstructedXp: replay.simulation.xpEstimated || 0,
            awardedMessages: replay.simulation.awardedMessages || 0,
            completeness: replay.completeness,
        },
        warnings,
        records,
        summary: summarizeRecords(records),
    };
}

function proposalsFromPreview(preview) {
    return preview.records
        .filter(record => Number(record.confirmedMinimumLevel || 0) > 0)
        .map(record => ({
            guildId: preview.guildId,
            userId: record.userId,
            userTag: record.userTag || null,
            confirmedLevel: record.confirmedMinimumLevel,
            requiredTotalXp: record.requiredTotalXp,
            evidence: {
                roleMinLevel: record.roleMinLevel || 0,
                announcementMinLevel: record.announcementMinLevel || 0,
                announcementCount: record.announcementCount || 0,
                firstAnnouncementAt: record.firstAnnouncementAt || null,
                lastAnnouncementAt: record.lastAnnouncementAt || null,
                heldRoleIds: record.heldRoleIds || [],
                confidenceWarnings: record.confidenceWarnings || [],
                reconstructedLevel: record.reconstructedLevel || 0,
                reconstructedXp: record.reconstructedXp || 0,
                migrationPolicy: FINAL_PROBOT_MIGRATION_POLICY.id,
            },
        }));
}

async function applyFinalProbotMigration(guild, options = {}) {
    const preview = await buildFinalProbotMigrationPreview(guild, options);
    const proposals = proposalsFromPreview(preview);
    const result = await applyLevelProbotFinalMigration({
        guildId: guild.id,
        mode: options.mode || (options.targetUserId ? 'single_user_test' : 'server_apply'),
        targetUserId: options.targetUserId || null,
        currentMemberOnly: preview.currentMemberOnly,
        importJobId: preview.importJob?.id || null,
        createdBy: options.adminId || null,
        policy: FINAL_PROBOT_MIGRATION_POLICY,
        result: {
            previewSummary: preview.summary,
            warnings: preview.warnings,
            scopedUserIds: preview.scopedUserIds,
            settings: preview.settings,
        },
        proposals,
    });

    return {
        ...result,
        preview,
    };
}

async function rollbackFinalProbotMigration(batchId, options = {}) {
    return rollbackLevelProbotFinalMigration(batchId, {
        adminId: options.adminId || null,
    });
}

async function latestFinalProbotMigrationBatch(guildId) {
    return (await listLevelProbotMigrationBatches(guildId, {
        statuses: ['applied'],
        limit: 1,
    }))[0] || null;
}

module.exports = {
    FINAL_PROBOT_MIGRATION_POLICY,
    applyFinalProbotMigration,
    buildFinalProbotMigrationPreview,
    latestFinalProbotMigrationBatch,
    proposalsFromPreview,
    rollbackFinalProbotMigration,
    resolveCompletedImportJob,
    summarizeRecords,
    toUserIdSet,
    getLevelProbotMigrationBatch,
};
