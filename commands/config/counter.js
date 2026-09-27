const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { refreshMemberCounters } = require('../../utils/memberCounters');

const typeChoices = [
    { name: 'Members', value: 'members' },
    { name: 'Bots', value: 'bots' },
    { name: 'Boosters', value: 'boosters' },
    { name: 'Specific Role', value: 'role' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('counter')
        .setDescription('Configure member counter voice channels.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add or replace a member counter.')
                .addStringOption(option => option.setName('type').setDescription('Counter type.').setRequired(true).addChoices(...typeChoices))
                .addChannelOption(option => option.setName('channel').setDescription('Voice channel to rename.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role to count when type is role.'))
                .addStringOption(option => option.setName('name_format').setDescription('Name format, using {count}. Example: Members: {count}')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a member counter.')
                .addChannelOption(option => option.setName('channel').setDescription('Counter channel.').addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List member counters.'))
        .addSubcommand(subcommand => subcommand.setName('refresh').setDescription('Refresh counters now.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const type = interaction.options.getString('type', true);
            const channel = interaction.options.getChannel('channel', true);
            const role = interaction.options.getRole('role');
            const nameFormat = interaction.options.getString('name_format') || null;

            if (type === 'role' && !role) {
                return interaction.reply({ content: 'A role is required for role counters.', ephemeral: true });
            }

            updateConfig(config => {
                config.memberCounters = (config.memberCounters || []).filter(counter => counter.channelId !== channel.id);
                config.memberCounters.push({
                    enabled: true,
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    type,
                    roleId: role?.id || '',
                    nameFormat,
                });
                return config;
            });

            await refreshMemberCounters(interaction.guild);
            return interaction.reply({ content: `Counter configured for <#${channel.id}>.`, ephemeral: true });
        }

        if (subcommand === 'remove') {
            const channel = interaction.options.getChannel('channel', true);
            updateConfig(config => {
                config.memberCounters = (config.memberCounters || []).filter(counter => counter.channelId !== channel.id);
                return config;
            });

            return interaction.reply({ content: `Counter removed for <#${channel.id}>.`, ephemeral: true });
        }

        if (subcommand === 'refresh') {
            const refreshed = await refreshMemberCounters(interaction.guild);
            return interaction.reply({ content: `Refreshed ${refreshed} counter channel${refreshed === 1 ? '' : 's'}.`, ephemeral: true });
        }

        const counters = (getConfig().memberCounters || []).filter(counter => !counter.guildId || counter.guildId === interaction.guild.id);
        const embed = createEmbed({
            title: 'Member Counters',
            color: 'blue',
            description: counters.length
                ? counters.map(counter => `<#${counter.channelId}> - ${counter.type}${counter.roleId ? ` <@&${counter.roleId}>` : ''}`).join('\n')
                : 'No member counters configured.',
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
