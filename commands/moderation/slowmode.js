const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set slowmode for a channel.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to update.')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread)
                .setRequired(true))
        .addIntegerOption(option =>
            option
                .setName('seconds')
                .setDescription('Slowmode delay in seconds. Use 0 to disable.')
                .setMinValue(0)
                .setMaxValue(21600)
                .setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the slowmode change.')),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        const seconds = interaction.options.getInteger('seconds', true);
        const reason = interaction.options.getString('reason') || 'Slowmode updated';

        if (typeof channel.setRateLimitPerUser !== 'function') {
            return interaction.reply({ content: 'That channel does not support slowmode.', flags: 64 });
        }

        await channel.setRateLimitPerUser(seconds, reason);
        await sendLog(interaction.guild, {
            type: 'moderation',
            title: 'Slowmode updated',
            color: 'blue',
            user: interaction.user,
            fields: [
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Seconds', value: `${seconds}`, inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Reason', value: reason },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `Slowmode for <#${channel.id}> is now ${seconds} seconds.`, flags: 64 });
    },
};
