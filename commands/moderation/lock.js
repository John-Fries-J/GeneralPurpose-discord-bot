const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a channel for everyone.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to lock.')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for locking the channel.')),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        const reason = interaction.options.getString('reason') || 'Channel locked';

        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
        }, { reason });

        await sendLog(interaction.guild, {
            type: 'moderation',
            title: 'Channel locked',
            color: 'red',
            user: interaction.user,
            fields: [
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Reason', value: reason },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `<#${channel.id}> has been locked.`, flags: 64 });
    },
};
