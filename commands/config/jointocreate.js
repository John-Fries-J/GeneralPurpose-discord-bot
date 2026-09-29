const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { deleteJoinToCreateChannels } = require('../../utils/joinToCreate');
const { getGuildSettings, updateJoinToCreateSettings } = require('../../utils/guildConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jointocreate')
        .setDescription('Configure join-to-create voice channels.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Enable join-to-create.')
                .addChannelOption(option => option.setName('trigger_channel').setDescription('Voice channel users join to create their own.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
                .addChannelOption(option => option.setName('category').setDescription('Category for created channels.').addChannelTypes(ChannelType.GuildCategory))
                .addStringOption(option => option.setName('name_format').setDescription("Use {username} or {displayName}."))
                .addIntegerOption(option => option.setName('max_limit').setDescription('Highest user limit owners can set.').setMinValue(1).setMaxValue(99)))
        .addSubcommand(subcommand => subcommand.setName('disable').setDescription('Disable join-to-create.'))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View join-to-create settings.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            const triggerChannel = interaction.options.getChannel('trigger_channel', true);
            const category = interaction.options.getChannel('category');
            const nameFormat = interaction.options.getString('name_format') || "{username}'s Channel";
            const userLimitMax = interaction.options.getInteger('max_limit') || 25;

            await updateJoinToCreateSettings(interaction.guild.id, {
                enabled: true,
                triggerChannelId: triggerChannel.id,
                categoryId: category?.id || triggerChannel.parentId || '',
                nameFormat,
                userLimitMax,
            }, {
                actorId: interaction.user.id,
                source: 'command',
            });

            return interaction.reply({ content: `Join-to-create enabled using <#${triggerChannel.id}>.`, flags: 64 });
        }

        if (subcommand === 'disable') {
            await updateJoinToCreateSettings(interaction.guild.id, { enabled: false }, {
                actorId: interaction.user.id,
                source: 'command',
            });
            const deleted = await deleteJoinToCreateChannels(interaction.guild);
            return interaction.reply({ content: `Join-to-create disabled. Deleted ${deleted} active temporary voice channel${deleted === 1 ? '' : 's'}.`, flags: 64 });
        }

        const settings = (await getGuildSettings(interaction.guild.id)).joinToCreate || {};
        const embed = createEmbed({
            title: 'Join-to-Create Settings',
            color: settings.enabled ? 'green' : 'orange',
            fields: [
                { name: 'Enabled', value: settings.enabled ? 'Yes' : 'No', inline: true },
                { name: 'Trigger Channel', value: settings.triggerChannelId ? `<#${settings.triggerChannelId}>` : 'Not set', inline: true },
                { name: 'Category', value: settings.categoryId ? `<#${settings.categoryId}>` : 'Trigger channel category', inline: true },
                { name: 'Name Format', value: settings.nameFormat || "{username}'s Channel" },
                { name: 'Max Limit', value: `${settings.userLimitMax || 25}`, inline: true },
            ],
        });
        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
