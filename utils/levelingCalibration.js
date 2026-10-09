const crypto = require('node:crypto');
const { setImmediate: yieldImmediate } = require('node:timers/promises');
const {
    deterministicHistoricalXp,
    getLevelProgress,
    getLevelingConfig,
    getProfileDefaults,
    getXpForLevel,
    hashProfile,
} = require('./leveling');
const {
    getLevelImportJob,
    getUserLevelRecord,
    listLevelRoleMappings,
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

function applyReplayMessage(message, state, options = {}) {
    if (!message?.eligible) return false;
    const userFilter = options.userFilter || null;
    if (userFilter && !userFilter.has(String(message.userId))) return false;
    state.eligibleStored += 1;

    const createdAt = Number(message.createdAt || 0);
    const cooldownMs = Math.max(0, Number(state.profile.settings.cooldownSeconds || 0) * 1000);
    const previousAt = state.lastAwardedAt.get(message.userId);
    if (previousAt !== undefined && cooldownMs && createdAt - previousAt < cooldownMs) return false;

    const amount = hypotheticalMessageXp(message, state.profile);
    if (amount <= 0) return false;

    state.lastAwardedAt.set(message.userId, createdAt);
    const current = state.users.get(message.userId) || {
        userId: message.userId,
        userTag: message.userTag || null,
        reconstructedXp: 0,
        awardedMessages: 0,
        firstAwardedAt: createdAt,
        lastAwardedAt: createdAt,
    };
    current.userTag = message.userTag || current.userTag;
    current.reconstructedXp += amount;
    current.awardedMessages += 1;
    current.firstAwardedAt = Math.min(current.firstAwardedAt, createdAt);
    current.lastAwardedAt = Math.max(current.lastAwardedAt, createdAt);
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
    const states = normalized.map(createReplayState);
    const pageSize = integer(options.pageSize, 5000, { min: 100, max: 10000 });
    const yieldEvery = integer(options.yieldEvery, 25000, { min: 1000, max: 250000 });
    let visited = 0;

    await forEachImportMessage(job.id, async message => {
        visited += 1;
        for (const state of states) {
            applyReplayMessage(message, state, options);
        }
        if (visited % yieldEvery === 0) await yieldImmediate();
    }, { pageSize, userId: options.userId || null });

    return states.map(state => ({
        ...finalizeReplayState(state),
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

    const fetched = await fetchMembersForRoleRecovery(guild, options.targetUserId || null);
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

function scoreSimulationAgainstEvidence(simulation, evidenceMap, options = {}) {
    const ids = options.userIds || [...evidenceMap.keys()];
    const recordsByUser = simulation.recordsByUser || new Map((simulation.records || []).map(record => [record.userId, record]));
    const discrepancies = [];
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
        const hasMinimum = minGap === 0;
        const insideTentativeInterval = hasMinimum && (!evidence.upperBoundLevel || reconstructedLevel < evidence.upperBoundLevel);

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
        penalty,
        discrepancies: discrepancies.sort((a, b) => {
            return b.minimumGap - a.minimumGap
                || b.upperGap - a.upperGap
                || b.reconstructedLevel - a.reconstructedLevel
                || String(a.userId).localeCompare(String(b.userId));
        }),
    };
}

function buildProtectedRecords(simulation, evidenceMap = new Map(), options = {}) {
    const baseline = options.baseline || null;
    const baselineByUser = baseline?.recordsByUser || new Map((baseline?.records || []).map(record => [record.userId, record]));
    const userIds = new Set([
        ...simulation.recordsByUser.keys(),
        ...baselineByUser.keys(),
        ...evidenceMap.keys(),
        ...(options.userIds || []),
    ]);
    const records = [];

    for (const userId of userIds) {
        const reconstructed = simulation.recordsByUser.get(userId);
        const baselineRecord = baselineByUser.get(userId);
        const evidence = evidenceMap.get(userId) || null;
        const roleMinLevel = evidence?.roleMinLevel || 0;
        const reconstructedLevel = reconstructed?.reconstructedLevel || 0;
        const reconstructedXp = reconstructed?.reconstructedXp || 0;
        const protectedLevel = Math.max(reconstructedLevel, roleMinLevel);
        const protectedXp = Math.max(reconstructedXp, roleMinLevel > 0 ? getXpForLevel(roleMinLevel, simulation.profile.settings) : 0);
        records.push({
            userId,
            userTag: reconstructed?.userTag || baselineRecord?.userTag || evidence?.userTag || null,
            reconstructedLevel,
            reconstructedXp,
            protectedLevel,
            protectedXp,
            currentPreviewLevel: baselineRecord?.reconstructedLevel ?? null,
            currentPreviewXp: baselineRecord?.reconstructedXp ?? null,
            roleMinLevel,
            roleMinRoleId: evidence?.roleMinRoleId || null,
            upperBoundLevel: evidence?.upperBoundLevel || null,
            upperBoundReliable: evidence?.upperBoundReliable === true,
            minimumViolation: roleMinLevel > 0 && reconstructedLevel < roleMinLevel,
            tentativeOverestimate: Boolean(evidence?.upperBoundLevel && reconstructedLevel >= evidence.upperBoundLevel),
            awardedMessages: reconstructed?.awardedMessages || 0,
        });
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
    const maxProfiles = integer(options.maxProfiles, 32, { min: 1, max: 100 });
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
        [10, 20],
        [15, 25],
        [20, 30],
        [25, 35],
        [35, 55],
    ];
    const cooldowns = options.cooldowns || [30, 60, 90];
    const formulas = options.formulas || ['legacy', 'probot_inspired'];

    for (const [textXpMin, textXpMax] of xpRanges) {
        for (const cooldownSeconds of cooldowns) {
            for (const progressionFormula of formulas) {
                addCandidate(candidates, seen, {
                    label: `${textXpMin}-${textXpMax} XP, ${cooldownSeconds}s, ${progressionFormula}`,
                    source: 'grid',
                    settings: {
                        ...currentSettings,
                        xpProfile: progressionFormula === 'probot_inspired' ? 'probot_inspired' : 'custom',
                        textXpMin,
                        textXpMax,
                        cooldownSeconds,
                        progressionFormula,
                        xpPerLevelBase: 100,
                    },
                });
                if (candidates.length >= maxProfiles) return candidates;
            }
        }
    }

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
            score: training.penalty,
        };
    }).sort((a, b) => {
        return a.score - b.score
            || a.validation.penalty - b.validation.penalty
            || b.training.intervalAgreementRate - a.training.intervalAgreementRate
            || a.profile.label.localeCompare(b.profile.label);
    });

    return {
        evidenceCount: evidenceMap.size,
        trainingCount: split.trainingIds.length,
        validationCount: split.validationIds.length,
        results,
        best: results[0] || null,
    };
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

module.exports = {
    buildDefaultCalibrationProfiles,
    buildProtectedRecords,
    buildRoleEvidence,
    compactProfile,
    deriveRoleEvidenceForMember,
    fitCalibrationProfiles,
    hypotheticalMessageXp,
    importCompleteness,
    loadExistingRecords,
    normalizeCalibrationRoleMappings,
    replayImportJobProfiles,
    replayMessagesForProfiles,
    scoreSimulationAgainstEvidence,
    settingsFromJobProfile,
    splitEvidenceIds,
    xpDistributionProfile,
};
