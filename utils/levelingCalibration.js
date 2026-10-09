const crypto = require('node:crypto');
const { setImmediate: yieldImmediate } = require('node:timers/promises');
const {
    deterministicHistoricalXp,
    getGuildLevelingConfig,
    getLevelProgress,
    getLevelingConfig,
    getProfileDefaults,
    getXpForLevel,
    hashProfile,
} = require('./leveling');
const {
    getLevelImportJob,
    createLevelCalibrationJob,
    getLevelCalibrationJob,
    getUserLevelRecord,
    listHighestProbotAnnouncementLevels,
    listLevelCalibrationJobs,
    listLevelRoleMappings,
    summarizeProbotAnnouncementEvidence,
    requestCancelLevelCalibrationJob,
    updateLevelCalibrationJob,
} = require('./store');
const {
    fetchMembersForRoleRecovery,
    forEachImportMessage,
    settingsFromJobProfile,
} = require('./levelingImport');

function number(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function integer(value, fallback, bounds = {}) {
    return Math.floor(number(value, fallback, bounds));
}

function compactProfile(settings = {}) {
    return {
        textXpMin: integer(settings.textXpMin ?? settings.textXpPerMessage, 1, { min: 0, max: 1000 }),
        textXpMax: integer(settings.textXpMax ?? settings.textXpPerMessage, 1, { min: 0, max: 1000 }),
        cooldownSeconds: integer(settings.cooldownSeconds, 60, { min: 0, max: 86400 }),
        progressionFormula: settings.progressionFormula || 'legacy',
        xpPerLevelBase: integer(settings.xpPerLevelBase, 100, { min: 1, max: 1_000_000 }),
        xpCurveFactor: number(settings.xpCurveFactor, 1.18, { min: 1.01, max: 10 }),
        xpProfile: settings.xpProfile || 'custom',
    };
}

function xpDistributionProfile(settings = {}) {
    const profile = compactProfile(settings);
    return {
        textXpMin: profile.textXpMin,
        textXpMax: profile.textXpMax,
        version: 1,
    };
}

function normalizeCandidateProfile(candidate = {}, index = 0) {
    const settings = getLevelingConfig({ leveling: candidate.settings || candidate });
    const profile = compactProfile(settings);
    const id = candidate.id || hashProfile(profile);
    return {
        id,
        label: candidate.label || `Profile ${index + 1}`,
        source: candidate.source || 'custom',
        settings,
        profile,
        profileHash: hashProfile(profile),
    };
}

function profileKey(profile) {
    const compact = compactProfile(profile.settings || profile);
    return [
        compact.textXpMin,
        compact.textXpMax,
        compact.cooldownSeconds,
        compact.progressionFormula,
        compact.xpPerLevelBase,
        compact.xpCurveFactor,
        compact.xpProfile,
    ].join(':');
}

function replayScenarioKey(profile) {
    const compact = compactProfile(profile.settings || profile);
    const settings = profile.settings || profile;
    const channelMultipliers = Array.isArray(settings.channelMultipliers)
        ? settings.channelMultipliers
            .map(item => `${String(item.channelId)}=${number(item.multiplier, 1, { min: 0, max: 1000 })}`)
            .sort()
            .join(',')
        : '';
    return [
        compact.textXpMin,
        compact.textXpMax,
        compact.cooldownSeconds,
        channelMultipliers,
    ].join(':');
}

function channelMultiplier(channelId, settings = {}) {
    const multipliers = Array.isArray(settings.channelMultipliers) ? settings.channelMultipliers : [];
    return multipliers
        .filter(item => String(item.channelId) === String(channelId))
        .reduce((highest, item) => Math.max(highest, number(item.multiplier, 1, { min: 0, max: 1000 })), 1);
}

function hypotheticalMessageXp(message, profile) {
    const base = deterministicHistoricalXp(
        message.guildId,
        message.messageId,
        xpDistributionProfile(profile.settings),
    );
    return Math.round(base * channelMultiplier(message.channelId, profile.settings));
}

function createReplayState(profile) {
    return {
        profile,
        eligibleStored: 0,
        awardedMessages: 0,
        xpEstimated: 0,
        lastAwardedAt: new Map(),
        users: new Map(),
    };
}

function getReplayUserRecord(message, state, createdAt) {
    const current = state.users.get(message.userId) || {
        userId: message.userId,
        userTag: message.userTag || null,
        reconstructedXp: 0,
        accessibleMessages: 0,
        awardedMessages: 0,
        cooldownAdjustedMessages: 0,
        firstObservedAt: createdAt,
        lastObservedAt: createdAt,
        firstAwardedAt: null,
        lastAwardedAt: null,
    };
    current.userTag = message.userTag || current.userTag;
    current.accessibleMessages += 1;
    current.firstObservedAt = Math.min(current.firstObservedAt, createdAt);
    current.lastObservedAt = Math.max(current.lastObservedAt, createdAt);
    state.users.set(message.userId, current);
    return current;
}

function applyReplayMessage(message, state, options = {}) {
    if (!message?.eligible) return false;
    const userFilter = options.userFilter || null;
    if (userFilter && !userFilter.has(String(message.userId))) return false;
    state.eligibleStored += 1;

    const createdAt = Number(message.createdAt || 0);
    const current = getReplayUserRecord(message, state, createdAt);
    const cooldownMs = Math.max(0, Number(state.profile.settings.cooldownSeconds || 0) * 1000);
    const previousAt = state.lastAwardedAt.get(message.userId);
    if (previousAt !== undefined && cooldownMs && createdAt - previousAt < cooldownMs) return false;

    const amount = hypotheticalMessageXp(message, state.profile);
    if (amount <= 0) return false;

    state.lastAwardedAt.set(message.userId, createdAt);
    current.reconstructedXp += amount;
    current.awardedMessages += 1;
    current.cooldownAdjustedMessages = current.awardedMessages;
    current.firstAwardedAt = current.firstAwardedAt === null ? createdAt : Math.min(current.firstAwardedAt, createdAt);
    current.lastAwardedAt = current.lastAwardedAt === null ? createdAt : Math.max(current.lastAwardedAt, createdAt);
    state.users.set(message.userId, current);
    state.awardedMessages += 1;
    state.xpEstimated += amount;
    return true;
}

function finalizeReplayState(state) {
    const records = [...state.users.values()].map(record => {
        const progress = getLevelProgress({ textXp: record.reconstructedXp, voiceXp: 0 }, state.profile.settings);
        return {
            ...record,
            reconstructedLevel: progress.level,
        };
    }).sort((a, b) => b.reconstructedXp - a.reconstructedXp || String(a.userId).localeCompare(String(b.userId)));

    return {
        profile: state.profile,
        eligibleStored: state.eligibleStored,
        awardedMessages: state.awardedMessages,
        xpEstimated: state.xpEstimated,
        usersReconstructed: records.length,
        records,
        recordsByUser: new Map(records.map(record => [record.userId, record])),
    };
}

function replayMessagesForProfiles(messages = [], profiles = [], options = {}) {
    const normalized = profiles.map(normalizeCandidateProfile);
    const states = normalized.map(createReplayState);
    const ordered = [...messages].sort((a, b) => {
        return Number(a.createdAt || 0) - Number(b.createdAt || 0)
            || String(a.messageId).localeCompare(String(b.messageId));
    });

    for (const message of ordered) {
        for (const state of states) {
            applyReplayMessage(message, state, options);
        }
    }

    return states.map(finalizeReplayState);
}

async function replayImportJobProfiles(jobOrId, profiles = [], options = {}) {
    const job = typeof jobOrId === 'string' ? await getLevelImportJob(jobOrId) : jobOrId;
    if (!job) throw new Error('Level import job was not found.');
    const normalized = profiles.map(normalizeCandidateProfile);
    const scenarioStates = new Map();
    const scenarioByProfile = new Map();
    for (const profile of normalized) {
        const key = replayScenarioKey(profile);
        if (!scenarioStates.has(key)) scenarioStates.set(key, createReplayState(profile));
        scenarioByProfile.set(profile.profileHash, scenarioStates.get(key));
    }
    const pageSize = integer(options.pageSize, 5000, { min: 100, max: 10000 });
    const defaultYieldEvery = Math.max(100, Math.floor(10000 / Math.max(1, scenarioStates.size)));
    const yieldEvery = integer(options.yieldEvery, defaultYieldEvery, { min: 100, max: 250000 });
    let visited = 0;

    await forEachImportMessage(job.id, async message => {
        visited += 1;
        for (const state of scenarioStates.values()) {
            applyReplayMessage(message, state, options);
        }
        if (visited % yieldEvery === 0) {
            if (options.shouldCancel) await options.shouldCancel();
            await yieldImmediate();
        }
    }, { pageSize, userId: options.userId || null });

    if (options.shouldCancel) await options.shouldCancel();

    return normalized.map(profile => ({
        ...finalizeReplayState({
            ...scenarioByProfile.get(profile.profileHash),
            profile,
        }),
        jobId: job.id,
        guildId: job.guildId,
        messagesVisited: visited,
    }));
}

function normalizeCalibrationRoleMappings({ recoveryMappings = [], roleRewards = [], settings = getLevelingConfig() } = {}) {
    const byRole = new Map();
    for (const mapping of recoveryMappings || []) {
        const roleId = String(mapping.roleId || '');
        const minimumLevel = integer(mapping.minimumLevel, 0, { min: 0, max: 10000 });
        if (!roleId || minimumLevel <= 0) continue;
        byRole.set(roleId, {
            guildId: mapping.guildId || null,
            roleId,
            minimumLevel,
            source: 'role_map',
            sources: ['role_map'],
        });
    }

    for (const reward of roleRewards || []) {
        const roleId = String(reward.roleId || '');
        if (!roleId || byRole.has(roleId)) continue;
        const minimumLevel = reward.level !== null && reward.level !== undefined
            ? integer(reward.level, 0, { min: 0, max: 10000 })
            : getLevelProgress({ textXp: Number(reward.xp || 0), voiceXp: 0 }, settings).level;
        if (minimumLevel <= 0) continue;
        byRole.set(roleId, {
            guildId: reward.guildId || null,
            roleId,
            minimumLevel,
            source: 'reward_role',
            sources: ['reward_role'],
        });
    }

    return [...byRole.values()]
        .sort((a, b) => a.minimumLevel - b.minimumLevel || a.roleId.localeCompare(b.roleId));
}

function memberHasRole(member, roleId) {
    return member?.roles?.cache?.has?.(String(roleId)) === true;
}

function deriveRoleEvidenceForMember(member, mappings = []) {
    const held = mappings.filter(mapping => memberHasRole(member, mapping.roleId));
    if (!held.length) return null;

    const sortedHeld = [...held].sort((a, b) => a.minimumLevel - b.minimumLevel || a.roleId.localeCompare(b.roleId));
    const highest = sortedHeld[sortedHeld.length - 1];
    const next = mappings.find(mapping => mapping.minimumLevel > highest.minimumLevel) || null;
    const missingLower = mappings
        .filter(mapping => mapping.minimumLevel < highest.minimumLevel && !memberHasRole(member, mapping.roleId))
        .map(mapping => mapping.roleId);
    const notes = ['minimum_only_role_evidence'];
    if (next) notes.push('upper_bound_is_tentative');
    if (missingLower.length) notes.push('replacement_style_or_missing_lower_roles');
    if (sortedHeld.length > 1) notes.push('multiple_mapped_roles_held');

    return {
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        memberPresent: true,
        roleMinLevel: highest.minimumLevel,
        roleMinRoleId: highest.roleId,
        heldRoleIds: sortedHeld.map(mapping => mapping.roleId),
        upperBoundLevel: next?.minimumLevel || null,
        upperBoundRoleId: next?.roleId || null,
        upperBoundExclusive: Boolean(next),
        upperBoundReliable: false,
        evidenceQuality: 'confirmed_minimum',
        notes,
    };
}

async function buildRoleEvidence(guild, settings, options = {}) {
    const recoveryMappings = await listLevelRoleMappings(guild.id);
    const mappings = normalizeCalibrationRoleMappings({
        recoveryMappings,
        roleRewards: settings.roleRewards || [],
        settings,
    });
    if (!mappings.length) {
        return {
            mappings,
            recoveryMappings,
            complete: true,
            error: null,
            membersFetched: 0,
            evidence: new Map(),
            records: [],
        };
    }

    const targetUserIds = options.targetUserIds
        ? new Set([...options.targetUserIds].map(String))
        : (options.targetUserId ? new Set([String(options.targetUserId)]) : null);
    const fetched = await fetchMembersForRoleRecovery(guild, targetUserIds || null);
    const evidence = new Map();
    for (const member of fetched.members) {
        if (member.user?.bot) continue;
        const record = deriveRoleEvidenceForMember(member, mappings);
        if (record) evidence.set(record.userId, record);
    }

    return {
        mappings,
        recoveryMappings,
        complete: fetched.complete,
        error: fetched.error,
        membersFetched: fetched.members.length,
        evidence,
        records: [...evidence.values()].sort((a, b) => b.roleMinLevel - a.roleMinLevel || String(a.userId).localeCompare(String(b.userId))),
    };
}

async function buildCombinedHistoricalEvidence(guild, settings, options = {}) {
    const role = await buildRoleEvidence(guild, settings, options);
    const targetUserIds = options.targetUserIds
        ? [...toUserIdSet(options.targetUserIds)]
        : (options.targetUserId ? [String(options.targetUserId)] : []);
    const announcements = await listHighestProbotAnnouncementLevels(guild.id, {
        userIds: targetUserIds.length ? targetUserIds : undefined,
    });
    const evidence = new Map(role.evidence);

    for (const announcement of announcements) {
        const userId = String(announcement.userId);
        const existing = evidence.get(userId) || {
            userId,
            userTag: null,
            memberPresent: false,
            roleMinLevel: 0,
            roleMinRoleId: null,
            heldRoleIds: [],
            upperBoundLevel: null,
            upperBoundRoleId: null,
            upperBoundExclusive: false,
            upperBoundReliable: false,
            evidenceQuality: 'announcement_minimum',
            notes: [],
        };
        const announcementLevel = Number(announcement.announcementLevel || 0);
        evidence.set(userId, {
            ...existing,
            announcementMinLevel: Math.max(Number(existing.announcementMinLevel || 0), announcementLevel),
            announcementCount: Number(announcement.announcementCount || 0),
            firstAnnouncementAt: announcement.firstAnnouncementAt,
            lastAnnouncementAt: announcement.lastAnnouncementAt,
            evidenceQuality: existing.roleMinLevel > 0 ? 'role_and_announcement_minimum' : 'announcement_minimum',
            notes: [...new Set([...(existing.notes || []), 'announcement_is_confirmed_minimum'])],
        });
    }

    return {
        ...role,
        evidence,
        records: [...evidence.values()].sort((a, b) => {
            const aMinimum = Math.max(Number(a.roleMinLevel || 0), Number(a.announcementMinLevel || 0));
            const bMinimum = Math.max(Number(b.roleMinLevel || 0), Number(b.announcementMinLevel || 0));
            return bMinimum - aMinimum || String(a.userId).localeCompare(String(b.userId));
        }),
        announcements,
        announcementSummary: await summarizeProbotAnnouncementEvidence(guild.id),
    };
}

function deterministicBucket(value) {
    const hash = crypto.createHash('sha256').update(String(value)).digest();
    return hash.readUInt32BE(0) % 100;
}

function splitEvidenceIds(evidenceMap, holdoutPercent = 20) {
    const ids = [...evidenceMap.keys()].sort();
    if (ids.length < 5) return { trainingIds: ids, validationIds: [] };
    const validationIds = ids.filter(id => deterministicBucket(id) < holdoutPercent);
    if (!validationIds.length) validationIds.push(ids[ids.length - 1]);
    const validation = new Set(validationIds);
    return {
        trainingIds: ids.filter(id => !validation.has(id)),
        validationIds,
    };
}

function percentile(values = [], percent = 50) {
    const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
    return sorted[index];
}

function scoreSimulationAgainstEvidence(simulation, evidenceMap, options = {}) {
    const ids = options.userIds || [...evidenceMap.keys()];
    const recordsByUser = simulation.recordsByUser || new Map((simulation.records || []).map(record => [record.userId, record]));
    const discrepancies = [];
    const absLevelErrors = [];
    let intervalAgreement = 0;
    let minimumViolations = 0;
    let tentativeOverestimations = 0;
    let significantOverestimations = 0;
    let totalMinimumGap = 0;
    let totalUpperGap = 0;
    let penalty = 0;

    for (const userId of ids) {
        const evidence = evidenceMap.get(userId);
        if (!evidence) continue;
        const record = recordsByUser.get(userId);
        const reconstructedLevel = record?.reconstructedLevel || 0;
        const minGap = Math.max(0, evidence.roleMinLevel - reconstructedLevel);
        const upperGap = evidence.upperBoundLevel ? Math.max(0, reconstructedLevel - evidence.upperBoundLevel + 1) : 0;
        const levelError = minGap > 0 ? -minGap : (upperGap > 0 ? upperGap : 0);
        const hasMinimum = minGap === 0;
        const insideTentativeInterval = hasMinimum && (!evidence.upperBoundLevel || reconstructedLevel < evidence.upperBoundLevel);
        absLevelErrors.push(Math.abs(levelError));

        if (insideTentativeInterval) intervalAgreement += 1;
        if (minGap > 0) {
            minimumViolations += 1;
            totalMinimumGap += minGap;
            penalty += 100 + (minGap * minGap * 4);
        }
        if (upperGap > 0) {
            tentativeOverestimations += 1;
            totalUpperGap += upperGap;
            penalty += upperGap * upperGap;
            if (upperGap >= 10) {
                significantOverestimations += 1;
                penalty += 25;
            }
        }

        discrepancies.push({
            userId,
            userTag: evidence.userTag || record?.userTag || null,
            reconstructedLevel,
            reconstructedXp: record?.reconstructedXp || 0,
            roleMinLevel: evidence.roleMinLevel,
            upperBoundLevel: evidence.upperBoundLevel,
            minimumGap: minGap,
            upperGap,
            levelError,
            absLevelError: Math.abs(levelError),
        });
    }

    const evaluated = discrepancies.length;
    return {
        evaluated,
        intervalAgreement,
        intervalAgreementRate: evaluated ? intervalAgreement / evaluated : 0,
        minimumViolations,
        tentativeOverestimations,
        significantOverestimations,
        totalMinimumGap,
        totalUpperGap,
        medianAbsLevelError: percentile(absLevelErrors, 50),
        p75AbsLevelError: percentile(absLevelErrors, 75),
        p90AbsLevelError: percentile(absLevelErrors, 90),
        penalty,
        discrepancies: discrepancies.sort((a, b) => {
            return b.minimumGap - a.minimumGap
                || b.upperGap - a.upperGap
                || b.reconstructedLevel - a.reconstructedLevel
                || String(a.userId).localeCompare(String(b.userId));
        }),
    };
}

function toUserIdSet(value) {
    if (!value) return new Set();
    if (value instanceof Set) return new Set([...value].map(String));
    if (Array.isArray(value)) return new Set(value.map(String));
    return new Set([String(value)]);
}

function observedSpanDays(record) {
    if (record?.firstObservedAt === null || record?.firstObservedAt === undefined || record?.lastObservedAt === null || record?.lastObservedAt === undefined) return 0;
    return Math.max(0, (Number(record.lastObservedAt) - Number(record.firstObservedAt)) / 86_400_000);
}

function confidenceWarningsForRecord(record, evidence, options = {}) {
    const warnings = [];
    const importWarnings = options.importWarnings || [];
    if (importWarnings.length) warnings.push('import_has_incomplete_channel_coverage');
    if (options.evidenceComplete === false) warnings.push('member_fetch_was_partial');
    if (evidence?.notes?.includes('replacement_style_or_missing_lower_roles')) warnings.push('replacement_style_reward_roles');
    if (evidence?.upperBoundLevel) warnings.push('next_milestone_is_tentative');
    if (record.announcementMinLevel > record.reconstructedLevel) warnings.push('announcement_exceeds_surviving_message_reconstruction');
    if (record.confirmedMinimumLevel > 0 && record.accessibleMessages === 0) warnings.push('no_surviving_messages_for_confirmed_member');
    if (record.confirmedMinimumLevel >= 30 && record.accessibleMessages > 0 && observedSpanDays(record) < 1) warnings.push('very_short_observed_history_window');
    if (record.confirmedMinimumLevel >= 30 && record.cooldownAdjustedMessages < 10) warnings.push('sparse_surviving_history_compared_with_confirmed_minimum');
    if (!record.confirmedMinimumLevel && options.restrictToUserIds?.has?.(String(record.userId))) warnings.push('no_confirmed_historical_evidence_for_requested_user');
    return [...new Set(warnings)];
}

function coverageGroupForRecord(record) {
    const spanDays = observedSpanDays(record);
    if (record.accessibleMessages === 0) return 'questionable_history_coverage';
    if (record.confidenceWarnings?.some(warning => [
        'import_has_incomplete_channel_coverage',
        'member_fetch_was_partial',
        'very_short_observed_history_window',
    ].includes(warning))) {
        return 'questionable_history_coverage';
    }
    if ((record.accessibleMessages >= 250 || record.cooldownAdjustedMessages >= 100) && spanDays >= 7) {
        return 'substantial_surviving_history';
    }
    return 'all_role_evidence';
}

function buildProtectedRecords(simulation, evidenceMap = new Map(), options = {}) {
    const baseline = options.baseline || null;
    const baselineByUser = baseline?.recordsByUser || new Map((baseline?.records || []).map(record => [record.userId, record]));
    const restrictToUserIds = toUserIdSet(options.restrictToUserIds || options.userIds);
    const userIds = restrictToUserIds.size
        ? restrictToUserIds
        : new Set([
            ...simulation.recordsByUser.keys(),
            ...baselineByUser.keys(),
            ...evidenceMap.keys(),
        ]);
    const records = [];

    for (const userId of userIds) {
        const reconstructed = simulation.recordsByUser.get(userId);
        const baselineRecord = baselineByUser.get(userId);
        const evidence = evidenceMap.get(userId) || null;
        const roleMinLevel = evidence?.roleMinLevel || 0;
        const announcementMinLevel = evidence?.announcementMinLevel || 0;
        const confirmedMinimumLevel = Math.max(roleMinLevel, announcementMinLevel);
        const reconstructedLevel = reconstructed?.reconstructedLevel || 0;
        const reconstructedXp = reconstructed?.reconstructedXp || 0;
        const confirmedMinimumXp = confirmedMinimumLevel > 0 ? getXpForLevel(confirmedMinimumLevel, simulation.profile.settings) : 0;
        const protectedLevel = Math.max(reconstructedLevel, confirmedMinimumLevel);
        const protectedXp = Math.max(reconstructedXp, confirmedMinimumXp);
        const levelDeltaFromMinimum = confirmedMinimumLevel > 0 ? reconstructedLevel - confirmedMinimumLevel : null;
        const insideTentativeInterval = confirmedMinimumLevel > 0
            && reconstructedLevel >= confirmedMinimumLevel
            && (!evidence?.upperBoundLevel || reconstructedLevel < evidence.upperBoundLevel);
        const record = {
            userId,
            userTag: reconstructed?.userTag || baselineRecord?.userTag || evidence?.userTag || null,
            reconstructedLevel,
            reconstructedXp,
            protectedLevel,
            protectedXp,
            baselineReconstructedLevel: baselineRecord?.reconstructedLevel ?? null,
            baselineReconstructedXp: baselineRecord?.reconstructedXp ?? null,
            currentPreviewLevel: baselineRecord?.reconstructedLevel ?? null,
            currentPreviewXp: baselineRecord?.reconstructedXp ?? null,
            currentStoredLevel: null,
            currentStoredXp: null,
            roleMinLevel,
            announcementMinLevel,
            confirmedMinimumLevel,
            confirmedMinimumXp,
            roleMinRoleId: evidence?.roleMinRoleId || null,
            upperBoundLevel: evidence?.upperBoundLevel || null,
            tentativeNextMilestone: evidence?.upperBoundLevel || null,
            upperBoundReliable: evidence?.upperBoundReliable === true,
            minimumViolation: confirmedMinimumLevel > 0 && reconstructedLevel < confirmedMinimumLevel,
            tentativeOverestimate: Boolean(evidence?.upperBoundLevel && reconstructedLevel >= evidence.upperBoundLevel),
            estimatedOnly: confirmedMinimumLevel <= 0,
            accessibleMessages: reconstructed?.accessibleMessages || 0,
            cooldownAdjustedMessages: reconstructed?.cooldownAdjustedMessages ?? reconstructed?.awardedMessages ?? 0,
            awardedMessages: reconstructed?.awardedMessages || 0,
            firstObservedAt: reconstructed?.firstObservedAt ?? null,
            lastObservedAt: reconstructed?.lastObservedAt ?? null,
            firstAwardedAt: reconstructed?.firstAwardedAt ?? null,
            lastAwardedAt: reconstructed?.lastAwardedAt ?? null,
            levelDeltaFromMinimum,
            insideTentativeInterval,
            heldRoleIds: evidence?.heldRoleIds || [],
            evidenceNotes: evidence?.notes || [],
            announcementCount: evidence?.announcementCount || 0,
            firstAnnouncementAt: evidence?.firstAnnouncementAt || null,
            lastAnnouncementAt: evidence?.lastAnnouncementAt || null,
        };
        record.confidenceWarnings = confidenceWarningsForRecord(record, evidence, {
            ...options,
            restrictToUserIds,
        });
        record.coverageGroup = coverageGroupForRecord(record);
        records.push(record);
    }

    return records.sort((a, b) => {
        const aDelta = a.currentPreviewLevel === null ? 0 : Math.abs(a.protectedLevel - a.currentPreviewLevel);
        const bDelta = b.currentPreviewLevel === null ? 0 : Math.abs(b.protectedLevel - b.currentPreviewLevel);
        return b.minimumViolation - a.minimumViolation
            || bDelta - aDelta
            || b.protectedLevel - a.protectedLevel
            || String(a.userId).localeCompare(String(b.userId));
    });
}

function addCandidate(candidates, seen, candidate) {
    const normalized = normalizeCandidateProfile(candidate, candidates.length);
    const key = profileKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
}

function buildDefaultCalibrationProfiles(currentSettings, jobProfile = {}, options = {}) {
    const candidates = [];
    const seen = new Set();
    const maxProfiles = integer(options.maxProfiles, 96, { min: 1, max: 250 });
    const storedSettings = settingsFromJobProfile(currentSettings, jobProfile || {});
    const probotDefaults = getProfileDefaults('probot_inspired');

    addCandidate(candidates, seen, {
        id: 'stored-import',
        label: 'Stored import profile',
        source: 'stored_import',
        settings: storedSettings,
    });
    addCandidate(candidates, seen, {
        id: 'current-guild',
        label: 'Current guild profile',
        source: 'current_guild',
        settings: currentSettings,
    });
    addCandidate(candidates, seen, {
        id: 'probot-inspired-default',
        label: 'ProBot-inspired default',
        source: 'probot_inspired',
        settings: {
            ...currentSettings,
            ...probotDefaults,
            xpProfile: 'probot_inspired',
        },
    });

    const xpRanges = options.xpRanges || [
        [5, 5],
        [10, 10],
        [15, 15],
        [20, 20],
        [25, 25],
        [30, 30],
        [40, 40],
        [5, 15],
        [10, 20],
        [15, 25],
        [20, 30],
        [25, 35],
        [30, 45],
        [35, 55],
        [50, 75],
    ];
    const cooldowns = options.cooldowns || [0, 15, 30, 45, 60, 90, 120, 180];
    const formulaProfiles = options.formulaProfiles || [
        { progressionFormula: 'legacy', xpPerLevelBase: 50 },
        { progressionFormula: 'legacy', xpPerLevelBase: 75 },
        { progressionFormula: 'legacy', xpPerLevelBase: 100 },
        { progressionFormula: 'legacy', xpPerLevelBase: 125 },
        { progressionFormula: 'legacy', xpPerLevelBase: 150 },
        { progressionFormula: 'legacy', xpPerLevelBase: 200 },
        { progressionFormula: 'linear', xpPerLevelBase: 1000 },
        { progressionFormula: 'linear', xpPerLevelBase: 1500 },
        { progressionFormula: 'quadratic', xpPerLevelBase: 5 },
        { progressionFormula: 'quadratic', xpPerLevelBase: 10 },
        { progressionFormula: 'quadratic', xpPerLevelBase: 25 },
        { progressionFormula: 'probot_inspired', xpPerLevelBase: 50 },
        { progressionFormula: 'probot_inspired', xpPerLevelBase: 100 },
        { progressionFormula: 'probot_inspired', xpPerLevelBase: 150 },
        { progressionFormula: 'exponential', xpPerLevelBase: 50, xpCurveFactor: 1.08 },
        { progressionFormula: 'exponential', xpPerLevelBase: 100, xpCurveFactor: 1.08 },
        { progressionFormula: 'exponential', xpPerLevelBase: 100, xpCurveFactor: 1.12 },
        { progressionFormula: 'exponential', xpPerLevelBase: 150, xpCurveFactor: 1.12 },
    ];

    const generated = [];
    for (const [textXpMin, textXpMax] of xpRanges) {
        for (const cooldownSeconds of cooldowns) {
            for (const formula of formulaProfiles) {
                generated.push({
                    textXpMin,
                    textXpMax,
                    cooldownSeconds,
                    ...formula,
                });
            }
        }
    }

    generated
        .sort((a, b) => {
            const aMid = (a.textXpMin + a.textXpMax) / 2;
            const bMid = (b.textXpMin + b.textXpMax) / 2;
            const formulaRank = formula => ({ legacy: 0, probot_inspired: 1, linear: 2, quadratic: 3, exponential: 4 }[formula] ?? 9);
            return Math.abs(aMid - 20) - Math.abs(bMid - 20)
                || Math.abs(a.cooldownSeconds - 30) - Math.abs(b.cooldownSeconds - 30)
                || Math.abs(a.xpPerLevelBase - 100) - Math.abs(b.xpPerLevelBase - 100)
                || formulaRank(a.progressionFormula) - formulaRank(b.progressionFormula)
                || (a.textXpMax - a.textXpMin) - (b.textXpMax - b.textXpMin);
        })
        .some(candidate => {
            addCandidate(candidates, seen, {
                label: `${candidate.textXpMin}-${candidate.textXpMax} XP, ${candidate.cooldownSeconds}s, ${candidate.progressionFormula}, base ${candidate.xpPerLevelBase}`,
                source: 'bounded_search',
                settings: {
                    ...currentSettings,
                    xpProfile: candidate.progressionFormula === 'probot_inspired' ? 'probot_inspired' : 'custom',
                    textXpMin: candidate.textXpMin,
                    textXpMax: candidate.textXpMax,
                    cooldownSeconds: candidate.cooldownSeconds,
                    progressionFormula: candidate.progressionFormula,
                    xpPerLevelBase: candidate.xpPerLevelBase,
                    xpCurveFactor: candidate.xpCurveFactor ?? currentSettings.xpCurveFactor ?? 1.18,
                },
            });
            return candidates.length >= maxProfiles;
        });

    return candidates.slice(0, maxProfiles);
}

async function fitCalibrationProfiles(job, profiles, evidenceMap, options = {}) {
    const split = splitEvidenceIds(evidenceMap, options.holdoutPercent ?? 20);
    const userFilter = new Set([...evidenceMap.keys()]);
    const simulations = await replayImportJobProfiles(job, profiles, {
        ...options,
        userFilter,
    });
    const results = simulations.map(simulation => {
        const training = scoreSimulationAgainstEvidence(simulation, evidenceMap, { userIds: split.trainingIds });
        const validation = scoreSimulationAgainstEvidence(simulation, evidenceMap, { userIds: split.validationIds });
        return {
            profile: simulation.profile,
            simulation,
            training,
            validation,
            score: training.penalty + (validation.evaluated ? validation.penalty : 0),
        };
    }).sort((a, b) => {
        return a.score - b.score
            || a.validation.penalty - b.validation.penalty
            || b.training.intervalAgreementRate - a.training.intervalAgreementRate
            || a.training.medianAbsLevelError - b.training.medianAbsLevelError
            || a.profile.label.localeCompare(b.profile.label);
    });

    return {
        evidenceCount: evidenceMap.size,
        trainingCount: split.trainingIds.length,
        validationCount: split.validationIds.length,
        results,
        best: results[0] || null,
        warnings: nonIdentifiabilityWarnings(results),
    };
}

function nonIdentifiabilityWarnings(results = []) {
    if (results.length < 2) return [];
    const best = results[0];
    const nearBest = results.filter(result => {
        const scoreClose = result.score <= best.score * 1.05 + 10;
        const agreementClose = Math.abs(result.training.intervalAgreementRate - best.training.intervalAgreementRate) <= 0.02;
        return scoreClose && agreementClose;
    });
    if (nearBest.length < 3) return [];
    const signatures = new Set(nearBest.map(result => {
        const profile = compactProfile(result.profile.settings);
        return `${profile.textXpMin}-${profile.textXpMax}/${profile.cooldownSeconds}/${profile.progressionFormula}/${profile.xpPerLevelBase}`;
    }));
    if (signatures.size < 3) return [];
    return [
        'Multiple materially different profiles score almost the same; role evidence does not identify a unique XP model.',
    ];
}

function importCompleteness(job) {
    const warnings = [];
    if (!job) {
        warnings.push({ type: 'missing_job', reason: 'The import job was not found.' });
    } else {
        if (job.status !== 'completed') warnings.push({ type: 'job_not_completed', reason: `Job status is ${job.status}.` });
        if ((job.skippedChannels || []).length) warnings.push({ type: 'skipped_channels', count: job.skippedChannels.length });
        if ((job.errors || []).length) warnings.push({ type: 'scan_errors', count: job.errors.length });
        if (Number(job.channelsTotal || 0) && Number(job.channelsScanned || 0) < Number(job.channelsTotal || 0)) {
            warnings.push({ type: 'partial_channel_scan', reason: `${job.channelsScanned}/${job.channelsTotal} channels scanned.` });
        }
    }
    return {
        complete: warnings.length === 0,
        warnings,
    };
}

async function loadExistingRecords(guildId, userIds = []) {
    const records = new Map();
    for (const userId of userIds) {
        const record = await getUserLevelRecord(guildId, userId);
        records.set(userId, record);
    }
    return records;
}

function totalXp(record) {
    return Number(record?.textXp || 0) + Number(record?.voiceXp || 0);
}

async function attachCurrentStoredLevels(records, guildId, settings) {
    for (const record of records) {
        const current = await getUserLevelRecord(guildId, record.userId);
        const xp = totalXp(current);
        const progress = getLevelProgress({ textXp: xp, voiceXp: 0 }, settings);
        record.currentStoredXp = current ? xp : 0;
        record.currentStoredLevel = current ? progress.level : 0;
    }
    return records;
}

function buildSimulatedLeaderboard(simulation, evidenceMap = new Map(), limit = 25) {
    const byUser = new Map();
    for (const record of simulation.records || []) {
        byUser.set(record.userId, {
            userId: record.userId,
            userTag: record.userTag || null,
            reconstructedXp: record.reconstructedXp || 0,
            reconstructedLevel: record.reconstructedLevel || 0,
            accessibleMessages: record.accessibleMessages || 0,
            cooldownAdjustedMessages: record.cooldownAdjustedMessages ?? record.awardedMessages ?? 0,
        });
    }
    for (const evidence of evidenceMap.values()) {
        if (!byUser.has(evidence.userId)) {
            byUser.set(evidence.userId, {
                userId: evidence.userId,
                userTag: evidence.userTag || null,
                reconstructedXp: 0,
                reconstructedLevel: 0,
                accessibleMessages: 0,
                cooldownAdjustedMessages: 0,
            });
        }
    }
    for (const record of byUser.values()) {
        const evidence = evidenceMap.get(record.userId);
        const roleMinLevel = evidence?.roleMinLevel || 0;
        const announcementMinLevel = evidence?.announcementMinLevel || 0;
        const confirmedMinimumLevel = Math.max(roleMinLevel, announcementMinLevel);
        const confirmedMinimumXp = confirmedMinimumLevel > 0 ? getXpForLevel(confirmedMinimumLevel, simulation.profile.settings) : 0;
        record.roleMinLevel = roleMinLevel;
        record.announcementMinLevel = announcementMinLevel;
        record.confirmedMinimumLevel = confirmedMinimumLevel;
        record.protectedXp = Math.max(record.reconstructedXp, confirmedMinimumXp);
        record.protectedLevel = getLevelProgress({ textXp: record.protectedXp, voiceXp: 0 }, simulation.profile.settings).level;
        record.estimatedOnly = confirmedMinimumLevel <= 0;
    }
    return [...byUser.values()]
        .sort((a, b) => b.protectedXp - a.protectedXp || String(a.userId).localeCompare(String(b.userId)))
        .slice(0, limit)
        .map((record, index) => ({ rank: index + 1, ...record }));
}

function summarizeEvidenceQuality(records = []) {
    const withRoleEvidence = records.filter(record => record.roleMinLevel > 0);
    const withAnnouncementEvidence = records.filter(record => record.announcementMinLevel > 0);
    const estimatedOnly = records.filter(record => record.estimatedOnly);
    const substantial = withRoleEvidence.filter(record => record.coverageGroup === 'substantial_surviving_history');
    const questionable = withRoleEvidence.filter(record => record.coverageGroup === 'questionable_history_coverage');
    return {
        allRoleEvidence: withRoleEvidence.length,
        allAnnouncementEvidence: withAnnouncementEvidence.length,
        estimatedOnly: estimatedOnly.length,
        substantialSurvivingHistory: substantial.length,
        questionableHistoryCoverage: questionable.length,
        criteria: {
            substantialSurvivingHistory: 'At least 250 accessible stored messages or 100 cooldown-adjusted messages, with observed history spanning at least 7 days.',
            questionableHistoryCoverage: 'No surviving messages, a very short observed history window for a high milestone, partial member evidence, or incomplete import channel coverage.',
        },
    };
}

function compactScoreMetrics(metrics) {
    if (!metrics) return null;
    const { discrepancies, ...summary } = metrics;
    return summary;
}

function compactCalibrationError(error) {
    return error?.message || String(error || 'Unknown error');
}

class CalibrationCancelledError extends Error {
    constructor(message = 'Calibration job was cancelled.') {
        super(message);
        this.name = 'CalibrationCancelledError';
    }
}

const calibrationJobs = new Map();

function isTerminalCalibrationStatus(status) {
    return ['completed', 'cancelled', 'failed'].includes(status);
}

async function assertCalibrationNotCancelled(jobId) {
    const job = await getLevelCalibrationJob(jobId);
    if (!job || job.cancelRequested || job.status === 'cancelling') throw new CalibrationCancelledError();
    return job;
}

async function updateCalibrationProgress(jobId, progress) {
    const job = await getLevelCalibrationJob(jobId);
    if (!job) return null;
    return updateLevelCalibrationJob(jobId, {
        progress: {
            ...(job.progress || {}),
            ...progress,
            updatedAt: Date.now(),
        },
    });
}

function parseJobUserIds(job) {
    return toUserIdSet(job.options?.userIds || []);
}

async function buildPreviewCalibrationResult(guild, importJob, calibrationJob, currentSettings) {
    const userIds = parseJobUserIds(calibrationJob);
    const includeProbotAnnouncements = calibrationJob.kind === 'migration_preview' || calibrationJob.options?.includeProbotAnnouncements === true;
    const target = {
        label: calibrationJob.profile?.label || 'Calibration profile',
        settings: getLevelingConfig({ leveling: calibrationJob.profile?.settings || calibrationJob.profile || {} }),
    };
    const baseline = {
        label: 'Stored import preview',
        settings: settingsFromJobProfile(currentSettings, importJob.profile || {}),
    };
    const completeness = importCompleteness(importJob);

    await updateCalibrationProgress(calibrationJob.id, { phase: 'role_evidence', percent: 15 });
    const evidence = includeProbotAnnouncements
        ? await buildCombinedHistoricalEvidence(guild, currentSettings, {
            targetUserIds: userIds.size ? userIds : null,
        })
        : await buildRoleEvidence(guild, currentSettings, {
            targetUserIds: userIds.size ? userIds : null,
        });
    await assertCalibrationNotCancelled(calibrationJob.id);

    await updateCalibrationProgress(calibrationJob.id, { phase: 'message_replay', percent: 35 });
    const simulations = await replayImportJobProfiles(importJob, [baseline, target], {
        userFilter: userIds.size ? userIds : null,
        shouldCancel: () => assertCalibrationNotCancelled(calibrationJob.id),
    });
    const records = buildProtectedRecords(simulations[1], evidence.evidence, {
        baseline: simulations[0],
        restrictToUserIds: userIds.size ? userIds : null,
        importWarnings: completeness.warnings,
        evidenceComplete: evidence.complete,
    });
    await attachCurrentStoredLevels(records, guild.id, currentSettings);

    await updateCalibrationProgress(calibrationJob.id, { phase: 'summarizing', percent: 85 });
    return {
        kind: includeProbotAnnouncements ? 'migration_preview' : 'preview',
        importJobId: importJob.id,
        profile: compactProfile(target.settings),
        profileLabel: target.label,
        scopedUserIds: [...userIds],
        completeness,
        evidence: {
            mappings: evidence.mappings.length,
            membersWithRoleEvidence: evidence.evidence.size,
            membersWithAnnouncementEvidence: evidence.announcementSummary?.uniqueVerifiedMembers || 0,
            verifiedAnnouncements: evidence.announcementSummary?.verifiedAnnouncements || 0,
            unresolvedAnnouncements: evidence.announcementSummary?.unresolvedIdentities || 0,
            highestAnnouncementLevel: evidence.announcementSummary?.highestRecoveredLevel || 0,
            membersFetched: evidence.membersFetched,
            complete: evidence.complete,
            error: evidence.error,
        },
        replay: {
            storedAwardedMessages: simulations[0].awardedMessages,
            calibratedAwardedMessages: simulations[1].awardedMessages,
            calibratedXp: simulations[1].xpEstimated,
            usersReconstructed: simulations[1].usersReconstructed,
            messagesVisited: simulations[1].messagesVisited,
        },
        quality: summarizeEvidenceQuality(records),
        records,
        simulatedLeaderboard: buildSimulatedLeaderboard(simulations[1], evidence.evidence, 25),
    };
}

async function buildFitCalibrationResult(guild, importJob, calibrationJob, currentSettings) {
    const maxProfiles = integer(calibrationJob.options?.maxProfiles, 10, { min: 1, max: 250 });
    const completeness = importCompleteness(importJob);

    await updateCalibrationProgress(calibrationJob.id, { phase: 'role_evidence', percent: 10 });
    const evidence = await buildRoleEvidence(guild, currentSettings);
    await assertCalibrationNotCancelled(calibrationJob.id);
    if (!evidence.evidence.size) {
        return {
            kind: 'fit',
            importJobId: importJob.id,
            evidence: {
                mappings: evidence.mappings.length,
                membersWithRoleEvidence: 0,
                membersFetched: evidence.membersFetched,
                complete: evidence.complete,
                error: evidence.error,
            },
            completeness,
            results: [],
            best: null,
            records: [],
            simulatedLeaderboard: [],
            warnings: ['No current members have mapped reward roles, so there is no role evidence to fit against.'],
        };
    }

    await updateCalibrationProgress(calibrationJob.id, { phase: 'bounded_model_search', percent: 25 });
    const profiles = buildDefaultCalibrationProfiles(currentSettings, importJob.profile || {}, { maxProfiles });
    const fit = await fitCalibrationProfiles(importJob, profiles, evidence.evidence, {
        shouldCancel: () => assertCalibrationNotCancelled(calibrationJob.id),
    });
    await assertCalibrationNotCancelled(calibrationJob.id);

    const baseline = fit.results.find(result => result.profile.source === 'stored_import')?.simulation || null;
    const bestRecords = fit.best ? buildProtectedRecords(fit.best.simulation, evidence.evidence, {
        baseline,
        importWarnings: completeness.warnings,
        evidenceComplete: evidence.complete,
    }) : [];
    await attachCurrentStoredLevels(bestRecords, guild.id, currentSettings);

    const ranked = fit.results.slice(0, 25).map(result => ({
        label: result.profile.label,
        source: result.profile.source,
        profile: compactProfile(result.profile.settings),
        score: result.score,
        training: compactScoreMetrics(result.training),
        validation: compactScoreMetrics(result.validation),
    }));
    return {
        kind: 'fit',
        importJobId: importJob.id,
        candidateProfiles: fit.results.length,
        trainingCount: fit.trainingCount,
        validationCount: fit.validationCount,
        evidence: {
            mappings: evidence.mappings.length,
            membersWithRoleEvidence: evidence.evidence.size,
            membersFetched: evidence.membersFetched,
            complete: evidence.complete,
            error: evidence.error,
        },
        completeness,
        best: fit.best ? ranked[0] : null,
        ranked,
        quality: summarizeEvidenceQuality(bestRecords),
        records: bestRecords,
        simulatedLeaderboard: fit.best ? buildSimulatedLeaderboard(fit.best.simulation, evidence.evidence, 25) : [],
        warnings: fit.warnings,
    };
}

async function processLevelCalibrationJob(client, jobId) {
    let calibrationJob = await getLevelCalibrationJob(jobId);
    if (!calibrationJob || isTerminalCalibrationStatus(calibrationJob.status)) return calibrationJob;
    if (calibrationJob.cancelRequested || calibrationJob.status === 'cancelling') {
        return updateLevelCalibrationJob(jobId, { status: 'cancelled', completedAt: Date.now() });
    }

    calibrationJob = await updateLevelCalibrationJob(jobId, {
        status: 'running',
        startedAt: calibrationJob.startedAt || Date.now(),
        progress: { phase: 'starting', percent: 1, updatedAt: Date.now() },
    });

    try {
        const importJob = await getLevelImportJob(calibrationJob.importJobId);
        if (!importJob) throw new Error('Level import job was not found.');
        if (importJob.guildId !== calibrationJob.guildId) throw new Error('Level import job belongs to a different guild.');
        if (importJob.status !== 'completed') throw new Error(`Level import job is ${importJob.status}; calibration requires a completed import.`);

        const guild = client.guilds.cache.get(calibrationJob.guildId) || await client.guilds.fetch(calibrationJob.guildId);
        const currentSettings = await getGuildLevelingConfig(guild.id);
        await assertCalibrationNotCancelled(jobId);

        const result = calibrationJob.kind === 'fit'
            ? await buildFitCalibrationResult(guild, importJob, calibrationJob, currentSettings)
            : await buildPreviewCalibrationResult(guild, importJob, calibrationJob, currentSettings);

        await assertCalibrationNotCancelled(jobId);
        return updateLevelCalibrationJob(jobId, {
            status: 'completed',
            completedAt: Date.now(),
            progress: { phase: 'completed', percent: 100, updatedAt: Date.now() },
            result,
        });
    } catch (error) {
        if (error instanceof CalibrationCancelledError) {
            return updateLevelCalibrationJob(jobId, {
                status: 'cancelled',
                completedAt: Date.now(),
                progress: { phase: 'cancelled', percent: calibrationJob.progress?.percent || 0, updatedAt: Date.now() },
            });
        }
        return updateLevelCalibrationJob(jobId, {
            status: 'failed',
            completedAt: Date.now(),
            error: compactCalibrationError(error),
            progress: { phase: 'failed', percent: calibrationJob.progress?.percent || 0, updatedAt: Date.now() },
        });
    }
}

function runLevelCalibrationJob(client, jobId) {
    if (calibrationJobs.has(jobId)) return false;
    const promise = yieldImmediate()
        .then(() => processLevelCalibrationJob(client, jobId))
        .finally(() => {
            calibrationJobs.delete(jobId);
        });
    calibrationJobs.set(jobId, promise);
    return true;
}

async function startLevelCalibrationJob(client, guild, options = {}) {
    const created = await createLevelCalibrationJob({
        guildId: guild.id,
        importJobId: options.importJobId,
        kind: options.kind || 'preview',
        profile: options.profile || {},
        options: {
            userIds: [...toUserIdSet(options.userIds)],
            maxProfiles: options.maxProfiles,
            exportFormat: options.exportFormat || 'none',
            includeProbotAnnouncements: options.includeProbotAnnouncements === true,
        },
        createdBy: options.createdBy || null,
    });
    if (created.ok) runLevelCalibrationJob(client, created.job.id);
    return created;
}

async function resumeLevelCalibrationJobs(client) {
    const jobs = await listLevelCalibrationJobs(null, { statuses: ['queued', 'running', 'cancelling'], limit: 100 });
    for (const job of jobs) {
        if (job.cancelRequested || job.status === 'cancelling') {
            await updateLevelCalibrationJob(job.id, { status: 'cancelled', completedAt: Date.now() });
        } else {
            await updateLevelCalibrationJob(job.id, { status: 'queued' });
            runLevelCalibrationJob(client, job.id);
        }
    }
    return jobs.length;
}

async function cancelLevelCalibration(jobId) {
    return requestCancelLevelCalibrationJob(jobId);
}

async function getLevelCalibrationStatus(jobId) {
    return getLevelCalibrationJob(jobId);
}

async function latestLevelCalibrationJob(guildId) {
    return (await listLevelCalibrationJobs(guildId, { limit: 1 }))[0] || null;
}

module.exports = {
    attachCurrentStoredLevels,
    buildCombinedHistoricalEvidence,
    buildDefaultCalibrationProfiles,
    buildProtectedRecords,
    buildRoleEvidence,
    buildSimulatedLeaderboard,
    cancelLevelCalibration,
    compactProfile,
    deriveRoleEvidenceForMember,
    fitCalibrationProfiles,
    getLevelCalibrationStatus,
    hypotheticalMessageXp,
    importCompleteness,
    latestLevelCalibrationJob,
    loadExistingRecords,
    normalizeCalibrationRoleMappings,
    processLevelCalibrationJob,
    replayImportJobProfiles,
    replayMessagesForProfiles,
    resumeLevelCalibrationJobs,
    scoreSimulationAgainstEvidence,
    settingsFromJobProfile,
    startLevelCalibrationJob,
    summarizeEvidenceQuality,
    splitEvidenceIds,
    xpDistributionProfile,
};
