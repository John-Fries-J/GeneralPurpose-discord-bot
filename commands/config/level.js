const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { formatXp, getGuildLevelingConfig, getLevelProgress } = require('../../utils/leveling');
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
    removeLevelRoleMapping,
    upsertLevelRoleMapping,
} = require('../../utils/store');

const policyChoices = [
    { name: 'Keep highest estimate', value: 'max' },
    { name: 'Messages only', value: 'messages_only' },
    { name: 'Roles only', value: 'roles_only' },
];

function requireApplyConfirmation(interaction) {
    const confirm = interaction.options.getString('confirm') || '';
    return confirm.toUpperCase() === 'APPLY';
}

function summarizeJob(job) {
    const status = job.status[0].toUpperCase() + job.status.slice(1);
    return [
        `Job: \`${job.id}\``,
        `Status: **${status}**`,
        `Mode: **${job.dryRun ? 'dry run' : 'apply'}**`,
        `Channels: **${job.channelsScanned}/${job.channelsTotal}**`,
        `Messages: **${job.messagesEligible}/${job.messagesSeen} eligible**`,
        `Estimated XP: **${formatXp(job.xpEstimated)}**`,
        `Applied XP: **${formatXp(job.xpApplied)}**`,
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
                .addStringOption(option => option.setName('confirm').setDescription('Type APPLY when apply:true is used.')))
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
                .addUserOption(option => option.setName('user').setDescription('Limit recovery to one member.'))
                .addStringOption(option => option.setName('confirm').setDescription('Type APPLY to confirm.').setRequired(true)))
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
            if (apply && !requireApplyConfirmation(interaction)) {
                return interaction.reply({ content: 'Type `APPLY` in the confirm option before applying imported XP. Run without `apply:true` for a dry run.', flags: 64 });
            }
            const user = interaction.options.getUser('user');
            const created = await startLevelImport(interaction.client, interaction.guild, {
                targetUserId: user?.id || null,
                dryRun: !apply,
                includeRoleRecovery: interaction.options.getBoolean('include_roles') === true,
                policy: interaction.options.getString('policy') || 'max',
                createdBy: interaction.user.id,
            });
            if (!created.ok) {
                return interaction.reply({ content: `A level import is already active: \`${created.job.id}\` (${created.job.status}).`, flags: 64 });
            }
            return interaction.reply({
                content: [
                    `Started ${apply ? 'applying' : 'dry-run'} historical XP import \`${created.job.id}\`.`,
                    'The scan runs in the background and only uses accessible Discord message history.',
                    'Use `/level import-status` to monitor progress.',
                ].join('\n'),
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
                color: status.job.status === 'completed' ? 'green' : (status.job.status === 'failed' ? 'red' : 'blue'),
                description: summarizeJob(status.job),
                fields: [
                    { name: 'Skipped channels', value: `${status.job.skippedChannels?.length || 0}`, inline: true },
                    { name: 'Errors', value: `${status.job.errors?.length || 0}`, inline: true },
                    { name: 'Checkpoints', value: `${status.checkpoints.length}`, inline: true },
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
            if (apply && !requireApplyConfirmation(interaction)) {
                return interaction.reply({ content: 'Type `APPLY` in the confirm option before applying role-derived minimum XP.', flags: 64 });
            }
            await interaction.deferReply({ flags: 64 });
            const user = interaction.options.getUser('user');
            const result = await previewRoleRecovery(interaction.guild, {
                targetUserId: user?.id || null,
                apply,
                adminId: interaction.user.id,
            });
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
                    ].join('\n'),
                    flags: 64,
                });
            }
        }

        return interaction.reply({ content: 'Unsupported level command.', flags: 64 });
    },
};
