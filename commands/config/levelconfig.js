const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { formatXp, getLevelingConfig, getXpForLevel, previewFormulaImpact } = require('../../utils/leveling');
const { getGuildSettings, updateLevelingSettings } = require('../../utils/guildConfig');

const modeChoices = [
    { name: 'Text only', value: 'text' },
    { name: 'Voice only', value: 'voice' },
    { name: 'Text and voice', value: 'both' },
];

const formulaChoices = [
    { name: 'Legacy cumulative', value: 'legacy' },
    { name: 'Linear', value: 'linear' },
    { name: 'Quadratic', value: 'quadratic' },
    { name: 'Exponential', value: 'exponential' },
    { name: 'ProBot-inspired estimate', value: 'probot_inspired' },
];

const profileChoices = [
    { name: 'Legacy/current', value: 'legacy' },
    { name: 'ProBot-inspired estimate', value: 'probot_inspired' },
    { name: 'Custom', value: 'custom' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('levelconfig')
        .setDescription('Configure the level system.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable leveling.')
                .addStringOption(option => option.setName('mode').setDescription('XP mode.').setRequired(true).addChoices(...modeChoices))
                .addIntegerOption(option => option.setName('text_xp').setDescription('Text XP per message.').setMinValue(0).setMaxValue(100))
                .addIntegerOption(option => option.setName('min_xp').setDescription('Minimum XP per eligible message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('max_xp').setDescription('Maximum XP per eligible message.').setMinValue(0).setMaxValue(1000))
                .addIntegerOption(option => option.setName('voice_xp').setDescription('Voice XP per minute.').setMinValue(0).setMaxValue(100))
                .addIntegerOption(option => option.setName('cooldown').setDescription('Text XP cooldown seconds.').setMinValue(0).setMaxValue(3600)))
        .addSubcommand(subcommand => subcommand.setName('disable').setDescription('Disable leveling.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('profile')
                .setDescription('Preview or apply an XP progression profile.')
                .addStringOption(option => option.setName('profile').setDescription('XP profile.').setRequired(true).addChoices(...profileChoices))
                .addStringOption(option => option.setName('formula').setDescription('Progression formula.').addChoices(...formulaChoices))
                .addIntegerOption(option => option.setName('base').setDescription('Base XP value for the selected formula.').setMinValue(1).setMaxValue(1000000))
                .addNumberOption(option => option.setName('factor').setDescription('Exponential curve factor.').setMinValue(1.01).setMaxValue(10))
                .addStringOption(option => option.setName('confirm').setDescription('Type APPLY to save after reviewing the impact.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-role')
                .setDescription('Add an XP role reward.')
                .addIntegerOption(option => option.setName('xp').setDescription('Total XP required.').setMinValue(1).setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Reward role.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-level-role')
                .setDescription('Add a level-based role reward.')
                .addIntegerOption(option => option.setName('level').setDescription('Level required.').setMinValue(1).setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Reward role.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-role')
                .setDescription('Remove a role reward.')
                .addRoleOption(option => option.setName('role').setDescription('Reward role.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-sync')
                .setDescription('Configure automatic reward-role synchronization.')
                .addBooleanOption(option => option.setName('enabled').setDescription('Enable reward-role sync.'))
                .addBooleanOption(option => option.setName('award_missing').setDescription('Grant missing reward roles.'))
                .addBooleanOption(option => option.setName('remove_obsolete').setDescription('Remove obsolete reward roles. Defaults false.'))
                .addBooleanOption(option => option.setName('apply_during_migration').setDescription('Apply role sync during historical imports.'))
                .addBooleanOption(option => option.setName('dry_run').setDescription('Preview role sync without changing Discord roles.'))
                .addBooleanOption(option => option.setName('sync_on_level_up').setDescription('Sync roles when users level up.')))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View level settings.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'enable') {
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const textXp = interaction.options.getInteger('text_xp') ?? current.textXpPerMessage ?? 1;
            const minXp = interaction.options.getInteger('min_xp') ?? current.textXpMin ?? textXp;
            const maxXp = interaction.options.getInteger('max_xp') ?? current.textXpMax ?? textXp;
            await updateLevelingSettings(interaction.guild.id, {
                enabled: true,
                mode: interaction.options.getString('mode', true),
                textXpPerMessage: textXp,
                textXpMin: Math.min(minXp, maxXp),
                textXpMax: Math.max(minXp, maxXp),
                voiceXpPerMinute: interaction.options.getInteger('voice_xp') ?? current.voiceXpPerMinute ?? 1,
                cooldownSeconds: interaction.options.getInteger('cooldown') ?? current.cooldownSeconds ?? 60,
                roleRewards: current.roleRewards || [],
            }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: 'Leveling enabled.', flags: 64 });
        }

        if (subcommand === 'disable') {
            await updateLevelingSettings(interaction.guild.id, { enabled: false }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: 'Leveling disabled.', flags: 64 });
        }

        if (subcommand === 'profile') {
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const next = {
                ...current,
                xpProfile: interaction.options.getString('profile', true),
                progressionFormula: interaction.options.getString('formula') || current.progressionFormula || (interaction.options.getString('profile', true) === 'probot_inspired' ? 'probot_inspired' : 'legacy'),
                xpPerLevelBase: interaction.options.getInteger('base') ?? current.xpPerLevelBase ?? 100,
                xpCurveFactor: interaction.options.getNumber('factor') ?? current.xpCurveFactor ?? 1.18,
            };
            const previewSettings = getLevelingConfig({ leveling: next });
            const impact = previewFormulaImpact(previewSettings);
            const description = [
                `Profile: **${previewSettings.xpProfile}**`,
                `Formula: **${previewSettings.progressionFormula}**`,
                '',
                ...impact.map(row => `Level ${row.level}: **${formatXp(row.xp)} XP**`),
                '',
                'This is a preview. Re-run with `confirm: APPLY` to save it.',
            ].join('\n');

            if ((interaction.options.getString('confirm') || '').toUpperCase() !== 'APPLY') {
                return interaction.reply({
                    embeds: [createEmbed({ title: 'XP Curve Impact Preview', color: 'orange', description })],
                    flags: 64,
                });
            }

            await updateLevelingSettings(interaction.guild.id, next, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({
                embeds: [createEmbed({ title: 'XP Curve Updated', color: 'green', description: description.replace('This is a preview. Re-run with `confirm: APPLY` to save it.', 'Saved.') })],
                flags: 64,
            });
        }

        if (subcommand === 'add-role') {
            const xp = interaction.options.getInteger('xp', true);
            const role = interaction.options.getRole('role', true);
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const roleRewards = (current.roleRewards || []).filter(reward => reward.roleId !== role.id);
            roleRewards.push({ xp, roleId: role.id });
            roleRewards.sort((a, b) => a.xp - b.xp);
            await updateLevelingSettings(interaction.guild.id, { roleRewards }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: `<@&${role.id}> will be awarded at ${xp} total XP.`, flags: 64 });
        }

        if (subcommand === 'add-level-role') {
            const level = interaction.options.getInteger('level', true);
            const role = interaction.options.getRole('role', true);
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const settings = getLevelingConfig({ leveling: current });
            const roleRewards = (current.roleRewards || []).filter(reward => reward.roleId !== role.id);
            roleRewards.push({ level, xp: getXpForLevel(level, settings), roleId: role.id });
            roleRewards.sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0) || Number(a.xp || 0) - Number(b.xp || 0));
            await updateLevelingSettings(interaction.guild.id, { roleRewards }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: `<@&${role.id}> will be awarded at level ${level} (${formatXp(getXpForLevel(level, settings))} XP with the current formula).`, flags: 64 });
        }

        if (subcommand === 'remove-role') {
            const role = interaction.options.getRole('role', true);
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const roleRewards = (current.roleRewards || []).filter(reward => reward.roleId !== role.id);
            await updateLevelingSettings(interaction.guild.id, { roleRewards }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: `Removed reward for <@&${role.id}>.`, flags: 64 });
        }

        if (subcommand === 'role-sync') {
            const current = (await getGuildSettings(interaction.guild.id)).leveling;
            const roleSync = {
                ...(current.roleSync || {}),
            };
            for (const [option, key] of [
                ['enabled', 'enabled'],
                ['award_missing', 'awardMissingRoles'],
                ['remove_obsolete', 'removeObsoleteRoles'],
                ['apply_during_migration', 'applyDuringMigration'],
                ['dry_run', 'dryRun'],
                ['sync_on_level_up', 'syncOnLevelUp'],
            ]) {
                const value = interaction.options.getBoolean(option);
                if (value !== null) roleSync[key] = value;
            }
            await updateLevelingSettings(interaction.guild.id, { roleSync }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            return interaction.reply({ content: 'Level reward-role sync settings updated. Role removal remains disabled unless explicitly set here.', flags: 64 });
        }

        const settings = (await getGuildSettings(interaction.guild.id)).leveling || {};
        const embed = createEmbed({
            title: 'Level Settings',
            color: settings.enabled ? 'green' : 'orange',
            fields: [
                { name: 'Enabled', value: settings.enabled ? 'Yes' : 'No', inline: true },
                { name: 'Mode', value: settings.mode || 'text', inline: true },
                { name: 'Text XP', value: `${settings.textXpMin ?? settings.textXpPerMessage ?? 1}-${settings.textXpMax ?? settings.textXpPerMessage ?? 1}`, inline: true },
                { name: 'Voice XP', value: `${settings.voiceXpPerMinute ?? 1}`, inline: true },
                { name: 'Cooldown', value: `${settings.cooldownSeconds ?? 60}s`, inline: true },
                { name: 'Formula', value: `${settings.progressionFormula || 'legacy'} (${settings.xpProfile || 'legacy'})`, inline: true },
                { name: 'Role Sync', value: settings.roleSync ? `Enabled: ${settings.roleSync.enabled !== false ? 'Yes' : 'No'}\nAward: ${settings.roleSync.awardMissingRoles !== false ? 'Yes' : 'No'}\nRemove: ${settings.roleSync.removeObsoleteRoles === true ? 'Yes' : 'No'}` : 'Default', inline: true },
                { name: 'Rewards', value: settings.roleRewards?.length ? settings.roleRewards.map(reward => `${reward.level ? `Level ${reward.level}` : `${reward.xp} XP`} -> <@&${reward.roleId}>`).join('\n') : 'None' },
            ],
        });
        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
