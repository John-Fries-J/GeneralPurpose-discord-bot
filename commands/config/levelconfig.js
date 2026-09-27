const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');

const modeChoices = [
    { name: 'Text only', value: 'text' },
    { name: 'Voice only', value: 'voice' },
    { name: 'Text and voice', value: 'both' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('levelconfig')
        .setDescription('Configure the level system.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable leveling.')
                .addStringOption(option => option.setName('mode').setDescription('XP mode.').setRequired(true).addChoices(...modeChoices))
                .addIntegerOption(option => option.setName('text_xp').setDescription('Text XP per message.').setMinValue(0).setMaxValue(100))
                .addIntegerOption(option => option.setName('voice_xp').setDescription('Voice XP per minute.').setMinValue(0).setMaxValue(100))
                .addIntegerOption(option => option.setName('cooldown').setDescription('Text XP cooldown seconds.').setMinValue(0).setMaxValue(3600)))
        .addSubcommand(subcommand => subcommand.setName('disable').setDescription('Disable leveling.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-role')
                .setDescription('Add an XP role reward.')
                .addIntegerOption(option => option.setName('xp').setDescription('Total XP required.').setMinValue(1).setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Reward role.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-role')
                .setDescription('Remove a role reward.')
                .addRoleOption(option => option.setName('role').setDescription('Reward role.').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View level settings.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'enable') {
            updateConfig(config => {
                config.leveling ||= {};
                config.leveling.enabled = true;
                config.leveling.mode = interaction.options.getString('mode', true);
                config.leveling.textXpPerMessage = interaction.options.getInteger('text_xp') ?? config.leveling.textXpPerMessage ?? 1;
                config.leveling.voiceXpPerMinute = interaction.options.getInteger('voice_xp') ?? config.leveling.voiceXpPerMinute ?? 1;
                config.leveling.cooldownSeconds = interaction.options.getInteger('cooldown') ?? config.leveling.cooldownSeconds ?? 60;
                config.leveling.roleRewards ||= [];
                return config;
            });
            return interaction.reply({ content: 'Leveling enabled.', ephemeral: true });
        }

        if (subcommand === 'disable') {
            updateConfig(config => {
                config.leveling ||= {};
                config.leveling.enabled = false;
                return config;
            });
            return interaction.reply({ content: 'Leveling disabled.', ephemeral: true });
        }

        if (subcommand === 'add-role') {
            const xp = interaction.options.getInteger('xp', true);
            const role = interaction.options.getRole('role', true);
            updateConfig(config => {
                config.leveling ||= {};
                config.leveling.roleRewards = (config.leveling.roleRewards || []).filter(reward => reward.roleId !== role.id);
                config.leveling.roleRewards.push({ xp, roleId: role.id });
                config.leveling.roleRewards.sort((a, b) => a.xp - b.xp);
                return config;
            });
            return interaction.reply({ content: `<@&${role.id}> will be awarded at ${xp} total XP.`, ephemeral: true });
        }

        if (subcommand === 'remove-role') {
            const role = interaction.options.getRole('role', true);
            updateConfig(config => {
                config.leveling ||= {};
                config.leveling.roleRewards = (config.leveling.roleRewards || []).filter(reward => reward.roleId !== role.id);
                return config;
            });
            return interaction.reply({ content: `Removed reward for <@&${role.id}>.`, ephemeral: true });
        }

        const settings = getConfig().leveling || {};
        const embed = createEmbed({
            title: 'Level Settings',
            color: settings.enabled ? 'green' : 'orange',
            fields: [
                { name: 'Enabled', value: settings.enabled ? 'Yes' : 'No', inline: true },
                { name: 'Mode', value: settings.mode || 'text', inline: true },
                { name: 'Text XP', value: `${settings.textXpPerMessage ?? 1}`, inline: true },
                { name: 'Voice XP', value: `${settings.voiceXpPerMinute ?? 1}`, inline: true },
                { name: 'Cooldown', value: `${settings.cooldownSeconds ?? 60}s`, inline: true },
                { name: 'Rewards', value: settings.roleRewards?.length ? settings.roleRewards.map(reward => `${reward.xp} XP -> <@&${reward.roleId}>`).join('\n') : 'None' },
            ],
        });
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
