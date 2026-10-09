const { AttachmentBuilder, InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { formatXp, getGuildLevelingConfig, getLevelProgress, getLevelingConfig, getProfileDefaults, getXpForLevel } = require('../../utils/leveling');
const {
    buildCombinedHistoricalEvidence,
    cancelLevelCalibration,
    compactProfile,
    getLevelCalibrationStatus,
    latestLevelCalibrationJob,
    settingsFromJobProfile,
    startLevelCalibrationJob,
} = require('../../utils/levelingCalibration');
const {
    DEFAULT_PROBOT_AUTHOR_ID,
    DEFAULT_PROBOT_SOURCE_CHANNEL_ID,
    cancelProbotScan,
    getProbotScanStatus,
    latestProbotScanJob,
    startProbotScan,
} = require('../../utils/probotRecovery');
const {
    cancelLevelImport,
    getLevelImportStatus,
    previewRoleRecovery,
    startLevelImport,
} = require('../../utils/levelingImport');
const { createXpTest, previewLevelTest, rollbackLevelTest } = require('../../utils/levelingTests');
const {
    listLevelImportJobs,
    listLevelRoleMappings,
    getUserLevelRecord,
    removeLevelRoleMapping,
    summarizeProbotAnnouncementEvidence,
    upsertLevelRoleMapping,
} = require('../../utils/store');

const policyChoices = [
    { name: 'Keep highest estimate', value: 'max' },
    { name: 'Messages only', value: 'messages_only' },
    { name: 'Roles only', value: 'roles_only' },
];

const calibrationProfileChoices = [
    { name: 'ProBot-inspired default', value: 'probot_inspired' },
    { name: 'Stored import profile', value: 'stored' },
    { name: 'Current guild profile', value: 'current' },
    { name: 'Custom options', value: 'custom' },
];

const calibrationFormulaChoices = [
    { name: 'Legacy cumulative', value: 'legacy' },
    { name: 'Linear', value: 'linear' },
    { name: 'Quadratic', value: 'quadratic' },
    { name: 'Exponential', value: 'exponential' },
    { name: 'ProBot-inspired estimate', value: 'probot_inspired' },
];

const exportChoices = [
    { name: 'No export', value: 'none' },
    { name: 'CSV', value: 'csv' },
    { name: 'JSON', value: 'json' },
];

function requireApplyConfirmation(interaction) {
    const confirm = interaction.options.getString('confirm') || '';
    const normalized = confirm.toUpperCase();
    return {
        apply: normalized === 'APPLY' || normalized === 'APPLY_INCOMPLETE',
        allowIncomplete: normalized === 'APPLY_INCOMPLETE',
    };
}

function summarizeJob(job) {
    const status = job.status[0].toUpperCase() + job.status.slice(1);
    const incomplete = job.result?.incomplete === true || (job.skippedChannels?.length || 0) > 0 || (job.errors?.length || 0) > 0;
    return [
        `Job: \`${job.id}\``,
        `Status: **${status}**`,
        `Mode: **${job.dryRun ? 'dry run' : 'apply'}**`,
        `Incomplete: **${incomplete ? 'yes' : 'no'}**`,
        `Channels: **${job.channelsScanned}/${job.channelsTotal}**`,
        `Messages: **${job.messagesEligible}/${job.messagesSeen} eligible**`,
        `Estimated XP: **${formatXp(job.xpEstimated)}**`,
        `Applied XP: **${formatXp(job.xpApplied)}**`,
        job.status === 'needs_confirmation' ? 'No XP was applied. Re-run with `confirm:APPLY_INCOMPLETE` only if the missing history is acceptable.' : null,
        job.currentChannelId ? `Current channel: <#${job.currentChannelId}>` : null,
    ].filter(Boolean).join('\n');
}

function topRows(records = []) {
    return records.slice(0, 10).map(record => {
        return `<@${record.userId}> - Level ${record.level ?? record.roleMinLevel ?? '?'} (${formatXp(record.finalXp ?? record.roleMinXp ?? 0)} XP)`;
    }).join('\n') || 'No affected members in the preview.';
}

async function latestGuildJob(guildId) {
    return (await listLevelImportJobs(guildId, { limit: 1 }))[0] || null;
}

async function latestCompletedGuildJob(guildId) {
    return (await listLevelImportJobs(guildId, { statuses: ['completed'], limit: 1 }))[0] || null;
}

function channelRows(channels = []) {
    return channels.slice(0, 5).map(channel => {
        const target = channel.parentId ? `<#${channel.parentId}>/${channel.name || channel.channelId}` : `<#${channel.channelId}>`;
        return `${target} - ${channel.reason || 'skipped'}`;
    }).join('\n') || 'None';
}

function summarizeProbotJob(job) {
    const status = job.status[0].toUpperCase() + job.status.slice(1);
    return [
        `Job: \`${job.id}\``,
        `Status: **${status}**`,
        `Source: <#${job.sourceChannelId}>`,
        `Author: \`${job.probotAuthorId}\``,
        `Channels: **${job.channelsScanned}/${job.channelsTotal}**`,
        `Scanned: **${formatXp(job.scannedCount)}**`,
        `Verified: **${formatXp(job.verifiedCount)}**`,
        `Unresolved: **${formatXp(job.unresolvedCount)}**`,
        `Invalid/skipped: **${formatXp(job.invalidCount)}/${formatXp(job.skippedCount)}**`,
        `Duplicates: **${formatXp(job.duplicateCount)}**`,
        job.currentChannelId ? `Current channel: <#${job.currentChannelId}>` : null,
    ].filter(Boolean).join('\n');
}

function probotCheckpointRows(checkpoints = []) {
    return checkpoints.slice(0, 5).map(checkpoint => {
        return `<#${checkpoint.channelId}> - ${checkpoint.status}, ${formatXp(checkpoint.scannedCount)} scanned, ${formatXp(checkpoint.verifiedCount)} verified`;
    }).join('\n') || 'No checkpoints recorded yet.';
}

function recoveryRows(records = [], limit = 10) {
    return records.slice(0, limit).map(record => {
        return `<@${record.userId}> - confirmed **${record.confirmedMinimumLevel}** (role ${record.roleMinLevel || 0}, announcement ${record.announcementMinLevel || 0}), current **${record.currentStoredLevel ?? 0}**, proposed **${record.protectedLevel ?? record.confirmedMinimumLevel}**`;
    }).join('\n') || 'No recovered level evidence found.';
}

function errorRows(errors = []) {
    return errors.slice(0, 5).map(error => {
        const channel = error.channel?.id ? `<#${error.channel.id}>` : 'unknown channel';
        return `${channel} - ${error.error || error.reason || 'failed'}`;
    }).join('\n') || 'None';
}

function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
}

function parseUserIds(value = '') {
    return new Set((String(value || '').match(/\d{15,25}/g) || []).map(String));
}

function formatCalibrationProfile(profileOrSettings) {
    const profile = compactProfile(profileOrSettings.settings || profileOrSettings);
    return [
        `XP: **${profile.textXpMin}-${profile.textXpMax}**`,
        `Cooldown: **${profile.cooldownSeconds}s**`,
        `Formula: **${profile.progressionFormula}**`,
        `Base: **${profile.xpPerLevelBase}**`,
    ].join('\n');
}

function buildCalibrationSettings(interaction, currentSettings, job) {
    const choice = interaction.options.getString('profile') || 'probot_inspired';
    let label = 'ProBot-inspired default';
    let next;

    if (choice === 'stored') {
        label = 'Stored import profile';
        next = settingsFromJobProfile(currentSettings, job.profile || {});
    } else if (choice === 'current') {
        label = 'Current guild profile';
        next = currentSettings;
    } else if (choice === 'probot_inspired') {
        next = {
            ...currentSettings,
            ...getProfileDefaults('probot_inspired'),
            xpProfile: 'probot_inspired',
        };
    } else {
        label = 'Custom profile';
        next = {
            ...currentSettings,
            xpProfile: 'custom',
        };
    }

    const minXp = interaction.options.getInteger('min_xp');
    const maxXp = interaction.options.getInteger('max_xp');
    if (minXp !== null || maxXp !== null) {
        const low = minXp ?? next.textXpMin ?? next.textXpPerMessage ?? 1;
        const high = maxXp ?? next.textXpMax ?? next.textXpPerMessage ?? low;
        next = {
            ...next,
            textXpMin: Math.min(low, high),
            textXpMax: Math.max(low, high),
        };
    }

    const cooldown = interaction.options.getInteger('cooldown');
    const formula = interaction.options.getString('formula');
    const base = interaction.options.getInteger('base');
    const factor = interaction.options.getNumber('factor');
    if (cooldown !== null) next = { ...next, cooldownSeconds: cooldown };
    if (formula) next = { ...next, progressionFormula: formula };
    if (base !== null) next = { ...next, xpPerLevelBase: base };
    if (factor !== null) next = { ...next, xpCurveFactor: factor };

    return {
        label,
        settings: getLevelingConfig({ leveling: next }),
    };
}

function calibrationRecordRows(records = [], limit = 10) {
    return records.slice(0, limit).map(record => {
        const role = record.roleMinLevel ? `role **${record.roleMinLevel}**` : 'no role';
        const announcement = record.announcementMinLevel ? `announcement **${record.announcementMinLevel}**` : 'no announcement';
        const confirmed = record.confirmedMinimumLevel ? `confirmed **${record.confirmedMinimumLevel}**` : 'estimated only';
        const stored = record.currentStoredLevel === null || record.currentStoredLevel === undefined ? '?' : record.currentStoredLevel;
        const delta = record.levelDeltaFromMinimum === null || record.levelDeltaFromMinimum === undefined
            ? 'n/a'
            : (record.levelDeltaFromMinimum >= 0 ? `+${record.levelDeltaFromMinimum}` : `${record.levelDeltaFromMinimum}`);
        const warnings = record.confidenceWarnings?.length ? `; ${record.confidenceWarnings.slice(0, 2).join(', ')}` : '';
        return `<@${record.userId}> - ${confirmed} (${role}, ${announcement}), recon **${record.reconstructedLevel}** (${formatXp(record.reconstructedXp)} XP), proposed **${record.protectedLevel}**, stored **${stored}**, delta **${delta}**, activity **${formatXp(record.accessibleMessages)}/${formatXp(record.cooldownAdjustedMessages)}**${warnings}`;
    }).join('\n') || 'No matching users found in the stored import data.';
}

function metricSummary(metrics) {
    return [
        `Evaluated: **${metrics.evaluated}**`,
        `Interval agreement: **${metrics.intervalAgreement}/${metrics.evaluated}** (${percent(metrics.intervalAgreementRate)})`,
        `Minimum violations: **${metrics.minimumViolations}**`,
        `Tentative overestimates: **${metrics.tentativeOverestimations}**`,
        `Significant overestimates: **${metrics.significantOverestimations}**`,
        `Median / p90 error: **${metrics.medianAbsLevelError}/${metrics.p90AbsLevelError}** levels`,
    ].join('\n');
}

function resultFitRows(results = []) {
    return results.slice(0, 5).map((result, index) => {
        const profile = compactProfile(result.profile);
        return [
            `${index + 1}. **${result.label}**`,
            `${profile.textXpMin}-${profile.textXpMax} XP, ${profile.cooldownSeconds}s, ${profile.progressionFormula}, base ${profile.xpPerLevelBase}`,
            `train ${percent(result.training.intervalAgreementRate)}, validation ${percent(result.validation.intervalAgreementRate)}, min ${result.training.minimumViolations}, over ${result.training.tentativeOverestimations}, median error ${result.training.medianAbsLevelError}`,
        ].join(' - ');
    }).join('\n') || 'No candidate profiles were evaluated.';
}

function leaderboardRows(records = []) {
    return records.slice(0, 25).map(record => {
        return `#${record.rank} <@${record.userId}> - level **${record.protectedLevel}**, ${formatXp(record.protectedXp)} XP`;
    }).join('\n') || 'No simulated leaderboard rows are available.';
}

function calibrationJobSummary(job) {
    const status = job.status[0].toUpperCase() + job.status.slice(1);
    const progress = job.progress?.percent !== undefined ? ` (${job.progress.percent}%, ${job.progress.phase || 'working'})` : '';
    return [
        `Calibration job: \`${job.id}\``,
        `Import job: \`${job.importJobId}\``,
        `Type: **${job.kind}**`,
        `Status: **${status}**${progress}`,
        job.error ? `Error: ${job.error}` : null,
    ].filter(Boolean).join('\n');
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createCalibrationExport(records, format, filenameBase, metadata = {}) {
    if (format === 'json') {
        const payload = JSON.stringify({ metadata, records }, null, 2);
        return new AttachmentBuilder(Buffer.from(payload, 'utf8'), { name: `${filenameBase}.json` });
    }
    if (format === 'csv') {
        const headers = [
            'user_id',
            'user_tag',
            'current_stored_level',
            'current_stored_xp',
            'baseline_reconstructed_level',
            'reconstructed_level',
            'reconstructed_xp',
            'protected_level',
            'protected_xp',
            'role_min_level',
            'announcement_min_level',
            'confirmed_minimum_level',
            'confirmed_minimum_xp',
            'estimated_only',
            'upper_bound_level',
            'level_delta_from_minimum',
            'inside_tentative_interval',
            'minimum_violation',
            'tentative_overestimate',
            'accessible_messages',
            'cooldown_adjusted_messages',
            'awarded_messages',
            'first_observed_at',
            'last_observed_at',
            'coverage_group',
            'confidence_warnings',
        ];
        const lines = [
            headers.join(','),
            ...records.map(record => headers.map(header => csvCell({
                user_id: record.userId,
                user_tag: record.userTag,
                current_stored_level: record.currentStoredLevel,
                current_stored_xp: record.currentStoredXp,
                baseline_reconstructed_level: record.baselineReconstructedLevel,
                reconstructed_level: record.reconstructedLevel,
                reconstructed_xp: record.reconstructedXp,
                protected_level: record.protectedLevel,
                protected_xp: record.protectedXp,
                role_min_level: record.roleMinLevel,
                announcement_min_level: record.announcementMinLevel,
                confirmed_minimum_level: record.confirmedMinimumLevel,
                confirmed_minimum_xp: record.confirmedMinimumXp,
                estimated_only: record.estimatedOnly,
                upper_bound_level: record.upperBoundLevel,
                level_delta_from_minimum: record.levelDeltaFromMinimum,
                inside_tentative_interval: record.insideTentativeInterval,
                minimum_violation: record.minimumViolation,
                tentative_overestimate: record.tentativeOverestimate,
                accessible_messages: record.accessibleMessages,
                cooldown_adjusted_messages: record.cooldownAdjustedMessages,
                awarded_messages: record.awardedMessages,
                first_observed_at: record.firstObservedAt,
                last_observed_at: record.lastObservedAt,
                coverage_group: record.coverageGroup,
                confidence_warnings: (record.confidenceWarnings || []).join(';'),
            }[header])).join(',')),
        ];
        return new AttachmentBuilder(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), { name: `${filenameBase}.csv` });
    }
    return null;
}

function createProbotRecoveryExport(records, format, filenameBase, metadata = {}) {
    if (format === 'json') {
        return new AttachmentBuilder(Buffer.from(JSON.stringify({ metadata, records }, null, 2), 'utf8'), { name: `${filenameBase}.json` });
    }
    if (format === 'csv') {
        const headers = [
            'user_id',
            'current_stored_level',
            'current_stored_xp',
            'role_min_level',
            'announcement_min_level',
            'confirmed_minimum_level',
            'confirmed_minimum_xp',
            'announcement_count',
            'first_announcement_at',
            'last_announcement_at',
            'held_role_ids',
        ];
        const lines = [
            headers.join(','),
            ...records.map(record => headers.map(header => csvCell({
                user_id: record.userId,
                current_stored_level: record.currentStoredLevel,
                current_stored_xp: record.currentStoredXp,
                role_min_level: record.roleMinLevel,
                announcement_min_level: record.announcementMinLevel,
                confirmed_minimum_level: record.confirmedMinimumLevel,
                confirmed_minimum_xp: record.confirmedMinimumXp,
                announcement_count: record.announcementCount,
                first_announcement_at: record.firstAnnouncementAt,
                last_announcement_at: record.lastAnnouncementAt,
                held_role_ids: (record.heldRoleIds || []).join(';'),
            }[header])).join(',')),
        ];
        return new AttachmentBuilder(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), { name: `${filenameBase}.csv` });
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Admin leveling migration and testing tools.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('import-history')
                .setDescription('Start a managed historical message XP import.')
                .addUserOption(option => option.setName('user').setDescription('Limit the import to one member.'))
                .addBooleanOption(option => option.setName('apply').setDescription('Apply imported XP. Defaults to a dry run.'))
                .addBooleanOption(option => option.setName('include_roles').setDescription('Use configured role-to-level recovery mappings.'))
                .addStringOption(option => option.setName('policy').setDescription('How to reconcile message and role estimates.').addChoices(...policyChoices))
                .addStringOption(option => option.setName('confirm').setDescription('Type APPLY, or APPLY_INCOMPLETE after reviewing skipped/failed scans.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('import-preview')
                .setDescription('Run a dry-run historical XP import preview.')
                .addUserOption(option => option.setName('user').setDescription('Limit the preview to one member.'))
                .addBooleanOption(option => option.setName('include_roles').setDescription('Use configured role-to-level recovery mappings.'))
                .addStringOption(option => option.setName('policy').setDescription('How to reconcile message and role estimates.').addChoices(...policyChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('import-status')
                .setDescription('Show the latest or selected level import job status.')
                .addStringOption(option => option.setName('job_id').setDescription('Import job ID. Defaults to the latest guild job.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('import-cancel')
                .setDescription('Cancel a running level import job.')
                .addStringOption(option => option.setName('job_id').setDescription('Import job ID. Defaults to the latest guild job.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('probot-scan')
                .setDescription('Start or resume a read-only ProBot level announcement scan.')
                .addChannelOption(option => option.setName('channel').setDescription('Announcement channel. Defaults to the configured ProBot source.'))
                .addStringOption(option => option.setName('additional_channels').setDescription('Optional extra channel or thread IDs/mentions to scan.'))
                .addStringOption(option => option.setName('probot_author_id').setDescription('ProBot user ID. Defaults to the known ProBot account.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('probot-status')
                .setDescription('Show ProBot announcement scan progress and evidence counts.')
                .addStringOption(option => option.setName('job_id').setDescription('Scan job ID. Defaults to the latest ProBot scan.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('probot-cancel')
                .setDescription('Cancel a running ProBot announcement scan.')
                .addStringOption(option => option.setName('job_id').setDescription('Scan job ID. Defaults to the latest ProBot scan.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('probot-preview')
                .setDescription('Preview confirmed levels from ProBot announcements and mapped roles.')
                .addUserOption(option => option.setName('user').setDescription('Limit the preview to one member.'))
                .addStringOption(option => option.setName('users').setDescription('Optional user IDs or mentions to preview.'))
                .addStringOption(option => option.setName('export').setDescription('Attach detailed recovered evidence.').addChoices(...exportChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('migration-preview')
                .setDescription('Start a read-only recovered-level migration simulation.')
                .addStringOption(option => option.setName('job_id').setDescription('Completed import job ID. Defaults to the latest completed import.'))
                .addStringOption(option => option.setName('profile').setDescription('Profile to simulate.').addChoices(...calibrationProfileChoices))
                .addIntegerOption(option => option.setName('min_xp').setDescription('Minimum XP per qualifying message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('max_xp').setDescription('Maximum XP per qualifying message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('cooldown').setDescription('Cooldown seconds.').setMinValue(0).setMaxValue(86400))
                .addStringOption(option => option.setName('formula').setDescription('Progression formula.').addChoices(...calibrationFormulaChoices))
                .addIntegerOption(option => option.setName('base').setDescription('XP base for the formula.').setMinValue(1).setMaxValue(1000000))
                .addNumberOption(option => option.setName('factor').setDescription('Exponential curve factor.').setMinValue(1.01).setMaxValue(10))
                .addStringOption(option => option.setName('users').setDescription('Optional user IDs or mentions to preview.'))
                .addStringOption(option => option.setName('export').setDescription('Remember preferred export format for the result.').addChoices(...exportChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-map-add')
                .setDescription('Map an existing reward role to a minimum level.')
                .addRoleOption(option => option.setName('role').setDescription('Existing reward role.').setRequired(true))
                .addIntegerOption(option => option.setName('level').setDescription('Minimum level established by the role.').setRequired(true).setMinValue(1).setMaxValue(10000)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-map-remove')
                .setDescription('Remove a role-to-level recovery mapping.')
                .addRoleOption(option => option.setName('role').setDescription('Mapped role.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-map-view')
                .setDescription('View configured role-to-level recovery mappings.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-recovery-preview')
                .setDescription('Preview XP recovery from existing reward roles.')
                .addUserOption(option => option.setName('user').setDescription('Limit the preview to one member.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-recovery-apply')
                .setDescription('Apply minimum XP recovery from existing reward roles.')
                .addStringOption(option => option.setName('confirm').setDescription('Type APPLY to confirm.').setRequired(true))
                .addUserOption(option => option.setName('user').setDescription('Limit recovery to one member.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('calibration-preview')
                .setDescription('Replay a completed import under a profile without changing XP.')
                .addStringOption(option => option.setName('job_id').setDescription('Completed import job ID.').setRequired(true))
                .addStringOption(option => option.setName('profile').setDescription('Profile to simulate.').addChoices(...calibrationProfileChoices))
                .addIntegerOption(option => option.setName('min_xp').setDescription('Minimum XP per qualifying message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('max_xp').setDescription('Maximum XP per qualifying message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('cooldown').setDescription('Cooldown seconds.').setMinValue(0).setMaxValue(86400))
                .addStringOption(option => option.setName('formula').setDescription('Progression formula.').addChoices(...calibrationFormulaChoices))
                .addIntegerOption(option => option.setName('base').setDescription('XP base for the formula.').setMinValue(1).setMaxValue(1000000))
                .addNumberOption(option => option.setName('factor').setDescription('Exponential curve factor.').setMinValue(1.01).setMaxValue(10))
                .addStringOption(option => option.setName('users').setDescription('Optional user IDs or mentions to preview.'))
                .addStringOption(option => option.setName('export').setDescription('Remember preferred export format for the result.').addChoices(...exportChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('calibration-fit')
                .setDescription('Fit candidate XP profiles against role-level evidence.')
                .addStringOption(option => option.setName('job_id').setDescription('Completed import job ID.').setRequired(true))
                .addIntegerOption(option => option.setName('max_profiles').setDescription('Maximum candidate profiles to evaluate.').setMinValue(1).setMaxValue(250))
                .addStringOption(option => option.setName('export').setDescription('Remember preferred export format for the result.').addChoices(...exportChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('calibration-status')
                .setDescription('Show a background calibration job status or result.')
                .addStringOption(option => option.setName('job_id').setDescription('Calibration job ID. Defaults to the latest calibration job.'))
                .addStringOption(option => option.setName('export').setDescription('Attach detailed results.').addChoices(...exportChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('calibration-cancel')
                .setDescription('Cancel a running calibration job.')
                .addStringOption(option => option.setName('job_id').setDescription('Calibration job ID. Defaults to the latest calibration job.')))
        .addSubcommandGroup(group =>
            group
                .setName('test')
                .setDescription('Smoke-test leveling changes with rollback support.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('set')
                        .setDescription('Set a member to a test level.')
                        .addUserOption(option => option.setName('user').setDescription('Member to test.').setRequired(true))
                        .addIntegerOption(option => option.setName('level').setDescription('Target level.').setRequired(true).setMinValue(0).setMaxValue(10000))
                        .addBooleanOption(option => option.setName('preview_only').setDescription('Do not mutate XP or roles.'))
                        .addBooleanOption(option => option.setName('apply_roles').setDescription('Grant missing levelling roles during the test.'))
                        .addBooleanOption(option => option.setName('remove_obsolete_roles').setDescription('Remove obsolete levelling roles during the test.')))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('xp')
                        .setDescription('Add test XP to a member.')
                        .addUserOption(option => option.setName('user').setDescription('Member to test.').setRequired(true))
                        .addIntegerOption(option => option.setName('amount').setDescription('XP amount to add.').setRequired(true).setMinValue(-100000000).setMaxValue(100000000))
                        .addBooleanOption(option => option.setName('preview_only').setDescription('Do not mutate XP or roles.'))
                        .addBooleanOption(option => option.setName('apply_roles').setDescription('Grant missing levelling roles during the test.'))
                        .addBooleanOption(option => option.setName('remove_obsolete_roles').setDescription('Remove obsolete levelling roles during the test.')))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('preview')
                        .setDescription('Preview a test level and reward-role result.')
                        .addUserOption(option => option.setName('user').setDescription('Member to preview.').setRequired(true))
                        .addIntegerOption(option => option.setName('level').setDescription('Target level.').setRequired(true).setMinValue(0).setMaxValue(10000)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('sync-roles')
                        .setDescription('Preview or apply reward-role sync for a member.')
                        .addUserOption(option => option.setName('user').setDescription('Member to sync.').setRequired(true))
                        .addBooleanOption(option => option.setName('apply').setDescription('Apply role changes. Defaults to preview.'))
                        .addBooleanOption(option => option.setName('remove_obsolete_roles').setDescription('Remove obsolete levelling roles.')))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('reset')
                        .setDescription('Temporarily reset a member to 0 XP with rollback support.')
                        .addUserOption(option => option.setName('user').setDescription('Member to reset.').setRequired(true))
                        .addBooleanOption(option => option.setName('preview_only').setDescription('Do not mutate XP or roles.')))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('rollback')
                        .setDescription('Rollback the latest active level test session for a member.')
                        .addUserOption(option => option.setName('user').setDescription('Member to roll back.').setRequired(true))
                        .addBooleanOption(option => option.setName('restore_roles').setDescription('Restore only levelling-managed role changes. Defaults to true.')))),

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'import-history' || subcommand === 'import-preview') {
            const apply = subcommand === 'import-history' && interaction.options.getBoolean('apply') === true;
            const confirmation = requireApplyConfirmation(interaction);
            if (apply && !confirmation.apply) {
                return interaction.reply({ content: 'Type `APPLY` in the confirm option before applying imported XP. Use `APPLY_INCOMPLETE` only after reviewing a dry run with skipped or failed scans.', flags: 64 });
            }
            const user = interaction.options.getUser('user');
            const created = await startLevelImport(interaction.client, interaction.guild, {
                targetUserId: user?.id || null,
                dryRun: !apply,
                includeRoleRecovery: interaction.options.getBoolean('include_roles') === true,
                policy: interaction.options.getString('policy') || 'max',
                allowIncompleteApply: confirmation.allowIncomplete,
                createdBy: interaction.user.id,
            });
            if (!created.ok) {
                return interaction.reply({ content: `A level import is already active: \`${created.job.id}\` (${created.job.status}).`, flags: 64 });
            }
            return interaction.reply({
                content: [
                    `Started ${apply ? 'applying' : 'dry-run'} historical XP import \`${created.job.id}\`.`,
                    'The scan runs in the background and only uses accessible Discord message history.',
                    apply && !confirmation.allowIncomplete ? 'If the scan is incomplete, it will stop before applying XP and ask for explicit incomplete-import confirmation.' : null,
                    'Use `/level import-status` to monitor progress.',
                ].filter(Boolean).join('\n'),
                flags: 64,
            });
        }

        if (subcommand === 'import-status') {
            const jobId = interaction.options.getString('job_id') || (await latestGuildJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No level import jobs have been recorded for this server.', flags: 64 });
            const status = await getLevelImportStatus(jobId);
            if (!status?.job) return interaction.reply({ content: 'That level import job was not found.', flags: 64 });
            const embed = createEmbed({
                title: 'Level Import Status',
                color: ['failed', 'needs_confirmation'].includes(status.job.status) ? 'red' : (status.job.status === 'completed' ? 'green' : 'blue'),
                description: summarizeJob(status.job),
                fields: [
                    { name: 'Skipped channels', value: `${status.job.skippedChannels?.length || 0}`, inline: true },
                    { name: 'Errors', value: `${status.job.errors?.length || 0}`, inline: true },
                    { name: 'Checkpoints', value: `${status.checkpoints.length}`, inline: true },
                    { name: 'Skipped detail', value: channelRows(status.job.skippedChannels || []), inline: false },
                    { name: 'Error detail', value: errorRows(status.job.errors || []), inline: false },
                    { name: 'Top Preview', value: topRows(status.job.result?.top || []), inline: false },
                ],
            });
            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        if (subcommand === 'import-cancel') {
            const jobId = interaction.options.getString('job_id') || (await latestGuildJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No level import job is available to cancel.', flags: 64 });
            const job = await cancelLevelImport(jobId);
            if (!job) return interaction.reply({ content: 'That level import job was not found.', flags: 64 });
            return interaction.reply({ content: `Cancellation requested for level import \`${job.id}\` (${job.status}).`, flags: 64 });
        }

        if (subcommand === 'probot-scan') {
            const channel = interaction.options.getChannel('channel');
            const sourceChannelId = channel?.id || DEFAULT_PROBOT_SOURCE_CHANNEL_ID;
            const additionalChannelIds = interaction.options.getString('additional_channels') || '';
            const probotAuthorId = interaction.options.getString('probot_author_id') || DEFAULT_PROBOT_AUTHOR_ID;
            let created;
            try {
                created = await startProbotScan(interaction.client, interaction.guild, {
                    sourceChannelId,
                    additionalChannelIds,
                    probotAuthorId,
                    createdBy: interaction.user.id,
                });
            } catch (error) {
                return interaction.reply({ content: `ProBot scan could not start: ${error.message}`, flags: 64 });
            }
            if (!created.ok) {
                return interaction.reply({
                    content: `A ProBot announcement scan is already active for <#${sourceChannelId}>: \`${created.job.id}\` (${created.job.status}). Use \`/level probot-status job_id:${created.job.id}\`.`,
                    flags: 64,
                });
            }
            return interaction.reply({
                content: [
                    `Started read-only ProBot announcement scan \`${created.job.id}\`.`,
                    `Source: <#${sourceChannelId}>. ProBot author: \`${probotAuthorId}\`.`,
                    'Only explicitly selected channels are scanned. No messages, XP, or roles will be changed.',
                    `Use \`/level probot-status job_id:${created.job.id}\` to monitor progress.`,
                ].join('\n'),
                flags: 64,
            });
        }

        if (subcommand === 'probot-status') {
            const jobId = interaction.options.getString('job_id') || (await latestProbotScanJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No ProBot scan jobs have been recorded for this server.', flags: 64 });
            const status = await getProbotScanStatus(jobId);
            if (!status?.job) return interaction.reply({ content: 'That ProBot scan job was not found.', flags: 64 });
            if (status.job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That ProBot scan job belongs to a different server.', flags: 64 });
            const summary = await summarizeProbotAnnouncementEvidence(interaction.guild.id);
            return interaction.reply({
                embeds: [createEmbed({
                    title: 'ProBot Recovery Scan Status',
                    color: status.job.status === 'failed' ? 'red' : (status.job.status === 'completed' ? 'green' : 'blue'),
                    description: summarizeProbotJob(status.job),
                    fields: [
                        { name: 'Persisted evidence', value: [
                            `Verified announcements: **${formatXp(summary.verifiedAnnouncements)}**`,
                            `Unique members: **${formatXp(summary.uniqueVerifiedMembers)}**`,
                            `Unresolved identities: **${formatXp(summary.unresolvedIdentities)}**`,
                            `Highest recovered level: **${formatXp(summary.highestRecoveredLevel)}**`,
                        ].join('\n'), inline: false },
                        { name: 'Checkpoints', value: probotCheckpointRows(status.checkpoints), inline: false },
                        { name: 'Errors', value: errorRows(status.job.errors || []), inline: false },
                    ],
                })],
                flags: 64,
            });
        }

        if (subcommand === 'probot-cancel') {
            const jobId = interaction.options.getString('job_id') || (await latestProbotScanJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No ProBot scan job is available to cancel.', flags: 64 });
            const job = await cancelProbotScan(jobId);
            if (!job) return interaction.reply({ content: 'That ProBot scan job was not found.', flags: 64 });
            if (job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That ProBot scan job belongs to a different server.', flags: 64 });
            return interaction.reply({ content: `Cancellation requested for ProBot scan \`${job.id}\` (${job.status}).`, flags: 64 });
        }

        if (subcommand === 'probot-preview') {
            await interaction.deferReply({ flags: 64 });
            const settings = await getGuildLevelingConfig(interaction.guild.id);
            const user = interaction.options.getUser('user');
            const userIds = parseUserIds(interaction.options.getString('users') || '');
            if (user) userIds.add(user.id);
            const evidence = await buildCombinedHistoricalEvidence(interaction.guild, settings, {
                targetUserIds: userIds.size ? userIds : null,
            });
            const records = [];
            for (const record of evidence.records) {
                const confirmedMinimumLevel = Math.max(Number(record.roleMinLevel || 0), Number(record.announcementMinLevel || 0));
                if (confirmedMinimumLevel <= 0 && !userIds.has(String(record.userId))) continue;
                const current = await getUserLevelRecord(interaction.guild.id, record.userId);
                const currentStoredXp = Number(current?.textXp || 0) + Number(current?.voiceXp || 0);
                records.push({
                    ...record,
                    confirmedMinimumLevel,
                    confirmedMinimumXp: getXpForLevel(confirmedMinimumLevel, settings),
                    currentStoredXp,
                    currentStoredLevel: getLevelProgress({ textXp: currentStoredXp, voiceXp: 0 }, settings).level,
                    protectedLevel: Math.max(getLevelProgress({ textXp: currentStoredXp, voiceXp: 0 }, settings).level, confirmedMinimumLevel),
                });
            }
            const summary = await summarizeProbotAnnouncementEvidence(interaction.guild.id);
            const exportFormat = interaction.options.getString('export') || 'none';
            const attachment = createProbotRecoveryExport(records, exportFormat, `probot-recovery-preview-${interaction.guild.id}`, {
                summary,
                mappings: evidence.mappings.length,
            });
            return interaction.editReply({
                embeds: [createEmbed({
                    title: 'ProBot Recovery Preview',
                    color: 'blue',
                    description: [
                        `Verified announcements: **${formatXp(summary.verifiedAnnouncements)}**`,
                        `Unique announcement members: **${formatXp(summary.uniqueVerifiedMembers)}**`,
                        `Unresolved identities: **${formatXp(summary.unresolvedIdentities)}**`,
                        `Role mappings: **${formatXp(evidence.mappings.length)}**`,
                        `Recovered members in preview: **${formatXp(records.length)}**`,
                        'No XP or roles were changed.',
                    ].join('\n'),
                    fields: [
                        { name: 'Top recovered members', value: recoveryRows(records, 10).slice(0, 1024), inline: false },
                    ],
                })],
                files: attachment ? [attachment] : [],
            });
        }

        if (subcommand === 'migration-preview') {
            const requestedJobId = interaction.options.getString('job_id');
            const status = requestedJobId
                ? await getLevelImportStatus(requestedJobId)
                : { job: await latestCompletedGuildJob(interaction.guild.id) };
            if (!status?.job) return interaction.reply({ content: 'No completed level import job was found for this server.', flags: 64 });
            if (status.job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That import job belongs to a different server.', flags: 64 });
            if (status.job.status !== 'completed') return interaction.reply({ content: `Job \`${status.job.id}\` is ${status.job.status}; migration previews require a completed import job.`, flags: 64 });

            const currentSettings = await getGuildLevelingConfig(interaction.guild.id);
            const target = buildCalibrationSettings(interaction, currentSettings, status.job);
            const userIds = parseUserIds(interaction.options.getString('users') || '');
            const created = await startLevelCalibrationJob(interaction.client, interaction.guild, {
                importJobId: status.job.id,
                kind: 'migration_preview',
                profile: target,
                userIds,
                exportFormat: interaction.options.getString('export') || 'none',
                includeProbotAnnouncements: true,
                createdBy: interaction.user.id,
            });
            if (!created.ok) {
                return interaction.reply({
                    content: `A preview job is already active for import \`${status.job.id}\`: \`${created.job.id}\` (${created.job.status}). Use \`/level calibration-status job_id:${created.job.id}\`.`,
                    flags: 64,
                });
            }

            return interaction.reply({
                content: [
                    `Started read-only recovered-level migration preview \`${created.job.id}\` for import \`${status.job.id}\`.`,
                    'It combines mapped role minimums, verified ProBot announcements, and reconstructed surviving-message estimates.',
                    'No XP, roles, Discord history, or leveling configuration will be changed.',
                    `Use \`/level calibration-status job_id:${created.job.id} export:${interaction.options.getString('export') || 'none'}\` to view results.`,
                ].join('\n'),
                flags: 64,
            });
        }

        if (subcommand === 'role-map-add') {
            const role = interaction.options.getRole('role', true);
            const level = interaction.options.getInteger('level', true);
            await upsertLevelRoleMapping({
                guildId: interaction.guild.id,
                roleId: role.id,
                minimumLevel: level,
                createdBy: interaction.user.id,
            });
            return interaction.reply({ content: `<@&${role.id}> now establishes a minimum level of ${level} for recovery previews and imports.`, flags: 64 });
        }

        if (subcommand === 'role-map-remove') {
            const role = interaction.options.getRole('role', true);
            await removeLevelRoleMapping(interaction.guild.id, role.id);
            return interaction.reply({ content: `Removed the recovery mapping for <@&${role.id}>.`, flags: 64 });
        }

        if (subcommand === 'role-map-view') {
            const mappings = await listLevelRoleMappings(interaction.guild.id);
            return interaction.reply({
                embeds: [createEmbed({
                    title: 'Role Recovery Mappings',
                    color: 'blue',
                    description: mappings.length
                        ? mappings.map(mapping => `<@&${mapping.roleId}> -> minimum level **${mapping.minimumLevel}**`).join('\n')
                        : 'No role-to-level mappings are configured.',
                })],
                flags: 64,
            });
        }

        if (subcommand === 'role-recovery-preview' || subcommand === 'role-recovery-apply') {
            const apply = subcommand === 'role-recovery-apply';
            if (apply && !requireApplyConfirmation(interaction).apply) {
                return interaction.reply({ content: 'Type `APPLY` in the confirm option before applying role-derived minimum XP.', flags: 64 });
            }
            await interaction.deferReply({ flags: 64 });
            const user = interaction.options.getUser('user');
            const result = await previewRoleRecovery(interaction.guild, {
                targetUserId: user?.id || null,
                apply,
                adminId: interaction.user.id,
            });
            if (!result.complete) {
                return interaction.editReply({
                    content: [
                        'Guild members could not be fetched completely, so role recovery results may be partial.',
                        result.error || 'Check the Guild Members intent and bot permissions, then retry.',
                        apply ? 'No role-derived XP was applied.' : null,
                    ].filter(Boolean).join('\n'),
                });
            }
            return interaction.editReply({
                embeds: [createEmbed({
                    title: apply ? 'Role Recovery Applied' : 'Role Recovery Preview',
                    color: apply ? 'green' : 'blue',
                    description: [
                        `Mappings: **${result.mappings}**`,
                        `Members matched: **${result.membersMatched}**`,
                        `Would change: **${result.wouldChange}**`,
                        `Applied: **${result.applied}**`,
                    ].join('\n'),
                    fields: [{ name: 'Top affected members', value: topRows(result.records.map(record => ({ ...record, level: getLevelProgress({ textXp: record.finalXp, voiceXp: 0 }, {}).level }))) }],
                })],
            });
        }

        if (subcommand === 'calibration-preview') {
            const jobId = interaction.options.getString('job_id', true);
            const status = await getLevelImportStatus(jobId);
            if (!status?.job) return interaction.reply({ content: 'That level import job was not found.', flags: 64 });
            if (status.job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That import job belongs to a different server.', flags: 64 });
            if (status.job.status !== 'completed') return interaction.reply({ content: `Job \`${status.job.id}\` is ${status.job.status}; calibration previews require a completed import job.`, flags: 64 });

            const currentSettings = await getGuildLevelingConfig(interaction.guild.id);
            const target = buildCalibrationSettings(interaction, currentSettings, status.job);
            const userIds = parseUserIds(interaction.options.getString('users') || '');
            const created = await startLevelCalibrationJob(interaction.client, interaction.guild, {
                importJobId: status.job.id,
                kind: 'preview',
                profile: target,
                userIds,
                exportFormat: interaction.options.getString('export') || 'none',
                createdBy: interaction.user.id,
            });
            if (!created.ok) {
                return interaction.reply({
                    content: `A calibration job is already active for import \`${status.job.id}\`: \`${created.job.id}\` (${created.job.status}). Use \`/level calibration-status job_id:${created.job.id}\`.`,
                    flags: 64,
                });
            }

            return interaction.reply({
                content: [
                    `Started read-only calibration preview \`${created.job.id}\` for import \`${status.job.id}\`.`,
                    userIds.size ? `Scope: **${userIds.size}** requested user ID${userIds.size === 1 ? '' : 's'}.` : 'Scope: all members with stored history and role evidence.',
                    'No XP, roles, Discord history scans, or leveling configuration will be changed.',
                    `Use \`/level calibration-status job_id:${created.job.id}\` to view progress and results.`,
                ].join('\n'),
                flags: 64,
            });
        }

        if (subcommand === 'calibration-fit') {
            const jobId = interaction.options.getString('job_id', true);
            const status = await getLevelImportStatus(jobId);
            if (!status?.job) return interaction.reply({ content: 'That level import job was not found.', flags: 64 });
            if (status.job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That import job belongs to a different server.', flags: 64 });
            if (status.job.status !== 'completed') return interaction.reply({ content: `Job \`${status.job.id}\` is ${status.job.status}; calibration fitting requires a completed import job.`, flags: 64 });

            const maxProfiles = interaction.options.getInteger('max_profiles') || 10;
            const created = await startLevelCalibrationJob(interaction.client, interaction.guild, {
                importJobId: status.job.id,
                kind: 'fit',
                maxProfiles,
                exportFormat: interaction.options.getString('export') || 'none',
                createdBy: interaction.user.id,
            });
            if (!created.ok) {
                return interaction.reply({
                    content: `A calibration job is already active for import \`${status.job.id}\`: \`${created.job.id}\` (${created.job.status}). Use \`/level calibration-status job_id:${created.job.id}\`.`,
                    flags: 64,
                });
            }

            return interaction.reply({
                content: [
                    `Started read-only calibration fit \`${created.job.id}\` for import \`${status.job.id}\`.`,
                    `Candidate cap: **${maxProfiles}** bounded profiles.`,
                    'No XP, roles, Discord history scans, or leveling configuration will be changed.',
                    `Use \`/level calibration-status job_id:${created.job.id}\` to view progress and results.`,
                ].join('\n'),
                flags: 64,
            });
        }

        if (subcommand === 'calibration-status') {
            const jobId = interaction.options.getString('job_id') || (await latestLevelCalibrationJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No calibration jobs have been recorded for this server.', flags: 64 });
            const job = await getLevelCalibrationStatus(jobId);
            if (!job) return interaction.reply({ content: 'That calibration job was not found.', flags: 64 });
            if (job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That calibration job belongs to a different server.', flags: 64 });

            const result = job.result || {};
            const exportFormat = interaction.options.getString('export') || job.options?.exportFormat || 'none';
            const attachment = job.status === 'completed'
                ? createCalibrationExport(result.records || [], exportFormat, `level-calibration-result-${job.id}`, {
                    calibrationJobId: job.id,
                    importJobId: job.importJobId,
                    kind: job.kind,
                    profile: result.profile || result.best?.profile || null,
                    evidence: result.evidence || null,
                    quality: result.quality || null,
                    simulatedLeaderboard: result.simulatedLeaderboard || [],
                })
                : null;
            const fields = [];
            if (job.status === 'completed' && ['preview', 'migration_preview'].includes(result.kind)) {
                fields.push(
                    {
                        name: 'Replay summary',
                        value: [
                            `Stored awarded: **${formatXp(result.replay?.storedAwardedMessages)}** messages`,
                            `Calibrated awarded: **${formatXp(result.replay?.calibratedAwardedMessages)}** messages`,
                            `Calibrated XP: **${formatXp(result.replay?.calibratedXp)}**`,
                            `Users reconstructed: **${formatXp(result.replay?.usersReconstructed)}**`,
                        ].join('\n'),
                        inline: false,
                    },
                    {
                        name: result.scopedUserIds?.length ? 'Requested users' : 'Largest discrepancies',
                        value: calibrationRecordRows(result.records || [], 8).slice(0, 1024),
                        inline: false,
                    },
                    {
                        name: 'Simulated top 25',
                        value: leaderboardRows(result.simulatedLeaderboard || []).slice(0, 1024),
                        inline: false,
                    },
                );
            } else if (job.status === 'completed' && result.kind === 'fit') {
                fields.push(
                    {
                        name: 'Suggested profile',
                        value: result.best ? [
                            `**${result.best.label}**`,
                            formatCalibrationProfile(result.best.profile),
                        ].join('\n') : 'No fit was produced.',
                        inline: false,
                    },
                    {
                        name: 'Training agreement',
                        value: result.best ? metricSummary(result.best.training) : 'No fit was produced.',
                        inline: true,
                    },
                    {
                        name: 'Validation agreement',
                        value: result.best && result.validationCount ? metricSummary(result.best.validation) : 'Not enough role evidence for a held-out validation set.',
                        inline: true,
                    },
                    {
                        name: 'Top candidates',
                        value: resultFitRows(result.ranked || []).slice(0, 1024),
                        inline: false,
                    },
                    {
                        name: 'Major discrepancies',
                        value: calibrationRecordRows(result.records || [], 8).slice(0, 1024),
                        inline: false,
                    },
                );
            }
            if (job.status === 'completed' && result.quality) {
                fields.push({
                    name: 'Evidence groups',
                    value: [
                        `All role evidence: **${result.quality.allRoleEvidence}**`,
                        `All announcement evidence: **${result.quality.allAnnouncementEvidence || 0}**`,
                        `Estimated-only: **${result.quality.estimatedOnly || 0}**`,
                        `Substantial surviving history: **${result.quality.substantialSurvivingHistory}**`,
                        `Questionable history coverage: **${result.quality.questionableHistoryCoverage}**`,
                    ].join('\n'),
                    inline: false,
                });
            }
            if (result.warnings?.length) {
                fields.push({ name: 'Model warnings', value: result.warnings.join('\n').slice(0, 1024), inline: false });
            }

            return interaction.reply({
                embeds: [createEmbed({
                    title: 'Level Calibration Status',
                    color: job.status === 'failed' ? 'red' : (job.status === 'completed' ? 'green' : 'blue'),
                    description: [
                        calibrationJobSummary(job),
                        result.evidence ? `Role evidence: **${result.evidence.membersWithRoleEvidence || 0}** members across **${result.evidence.mappings || 0}** mappings.` : null,
                        result.evidence?.verifiedAnnouncements ? `ProBot announcements: **${result.evidence.verifiedAnnouncements}** verified, **${result.evidence.membersWithAnnouncementEvidence || 0}** members, highest level **${result.evidence.highestAnnouncementLevel || 0}**.` : null,
                        result.completeness?.complete === false ? `Import completeness warning: ${result.completeness.warnings.map(warning => warning.type).join(', ')}` : null,
                        result.evidence?.complete === false ? `Member fetch warning: ${result.evidence.error || 'partial member results'}` : null,
                    ].filter(Boolean).join('\n'),
                    fields,
                })],
                files: attachment ? [attachment] : [],
                flags: 64,
            });
        }

        if (subcommand === 'calibration-cancel') {
            const jobId = interaction.options.getString('job_id') || (await latestLevelCalibrationJob(interaction.guild.id))?.id;
            if (!jobId) return interaction.reply({ content: 'No calibration job is available to cancel.', flags: 64 });
            const job = await cancelLevelCalibration(jobId);
            if (!job) return interaction.reply({ content: 'That calibration job was not found.', flags: 64 });
            if (job.guildId !== interaction.guild.id) return interaction.reply({ content: 'That calibration job belongs to a different server.', flags: 64 });
            return interaction.reply({ content: `Cancellation requested for calibration job \`${job.id}\` (${job.status}).`, flags: 64 });
        }

        if (group === 'test') {
            const member = interaction.options.getMember('user');
            if (!member) return interaction.reply({ content: 'That member is not available in this server.', flags: 64 });

            if (subcommand === 'preview') {
                const level = interaction.options.getInteger('level', true);
                const preview = await previewLevelTest(member, { level, awardMissingRoles: true });
                return interaction.reply({
                    content: [
                        `Current: level **${preview.before.level}** (${formatXp(preview.before.totalXp)} XP)`,
                        `Preview: level **${preview.after.level}** (${formatXp(preview.after.totalXp)} XP)`,
                        `XP delta: **${formatXp(preview.delta)}**`,
                        `Roles to add: ${preview.rolePlan.added.map(roleId => `<@&${roleId}>`).join(', ') || 'none'}`,
                        `Roles to remove: ${preview.rolePlan.removed.map(roleId => `<@&${roleId}>`).join(', ') || 'none'}`,
                    ].join('\n'),
                    flags: 64,
                });
            }

            if (subcommand === 'set' || subcommand === 'xp' || subcommand === 'reset') {
                const previewOnly = interaction.options.getBoolean('preview_only') === true;
                const result = await createXpTest(member, {
                    adminId: interaction.user.id,
                    level: subcommand === 'set' ? interaction.options.getInteger('level', true) : (subcommand === 'reset' ? 0 : undefined),
                    amount: subcommand === 'xp' ? interaction.options.getInteger('amount', true) : undefined,
                    previewOnly,
                    applyRoles: interaction.options.getBoolean('apply_roles') === true,
                    awardMissingRoles: interaction.options.getBoolean('apply_roles') === true,
                    removeObsoleteRoles: interaction.options.getBoolean('remove_obsolete_roles') === true,
                });
                const progress = getLevelProgress(result.record, await getGuildLevelingConfig(interaction.guild.id));
                return interaction.reply({
                    content: [
                        `${previewOnly ? 'Previewed' : 'Created'} level test session \`${result.session.id}\`.`,
                        `Current test result: level **${progress.level}**, **${formatXp(progress.totalXp)} XP**.`,
                        `Rollback with \`/level test rollback user:${member.user.tag}\`.`,
                        `Role changes: +${result.roleChanges.added.length} / -${result.roleChanges.removed.length}.`,
                    ].join('\n'),
                    flags: 64,
                });
            }

            if (subcommand === 'sync-roles') {
                const settings = await getGuildLevelingConfig(interaction.guild.id);
                const record = await getUserLevelRecord(interaction.guild.id, member.id);
                const apply = interaction.options.getBoolean('apply') === true;
                const result = await require('../../utils/leveling').syncRewardRoles(member, record, settings, {
                    awardMissingRoles: true,
                    removeObsoleteRoles: interaction.options.getBoolean('remove_obsolete_roles') === true,
                    dryRun: !apply,
                    force: true,
                });
                return interaction.reply({
                    content: [
                        `${apply ? 'Applied' : 'Previewed'} reward-role sync for <@${member.id}>.`,
                        `Add: ${result.added.map(roleId => `<@&${roleId}>`).join(', ') || 'none'}`,
                        `Remove: ${result.removed.map(roleId => `<@&${roleId}>`).join(', ') || 'none'}`,
                        `Skipped: ${result.skipped.length}`,
                        `Errors: ${result.errors.length}`,
                    ].join('\n'),
                    flags: 64,
                });
            }

            if (subcommand === 'rollback') {
                const result = await rollbackLevelTest(member, {
                    adminId: interaction.user.id,
                    restoreRoles: interaction.options.getBoolean('restore_roles') !== false,
                });
                if (!result.ok) return interaction.reply({ content: 'No active level test session was found for that member.', flags: 64 });
                const progress = getLevelProgress(result.record, await getGuildLevelingConfig(interaction.guild.id));
                return interaction.reply({
                    content: [
                        `Rolled back level test session \`${result.session.id}\`.`,
                        `Current XP after rollback: **${formatXp(progress.totalXp)}** (level **${progress.level}**).`,
                        `Role rollback: +${result.roleChanges.added.length} / -${result.roleChanges.removed.length}.`,
                        result.roleChanges.skipped?.length ? `Role skips: **${result.roleChanges.skipped.length}**.` : null,
                        result.roleChanges.errors?.length ? `Role errors: **${result.roleChanges.errors.length}**.` : null,
                    ].filter(Boolean).join('\n'),
                    flags: 64,
                });
            }
        }

        return interaction.reply({ content: 'Unsupported level command.', flags: 64 });
    },
};
