const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement embed to a channel.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to announce in.')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('The announcement message.').setMaxLength(4000).setRequired(true))
        .addStringOption(option => option.setName('title').setDescription('Optional announcement title.').setMaxLength(256)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        const message = interaction.options.getString('message', true);
        const title = interaction.options.getString('title') || 'Announcement';

        if (!channel?.send) {
            return interaction.reply({ content: 'That channel cannot receive announcements.', flags: 64 });
        }

        const embed = createEmbed({
            title,
            description: message,
            color: 'blue',
            footerText: `Posted by ${interaction.user.tag}`,
        });

        await channel.send({ embeds: [embed] });
        await sendLog(interaction.guild, {
            type: 'general',
            title: 'Announcement sent',
            color: 'blue',
            user: interaction.user,
            fields: [
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Title', value: title },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `Announcement sent to <#${channel.id}>.`, flags: 64 });
    },
};
