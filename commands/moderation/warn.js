const { InteractionContextType, ApplicationIntegrationType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const moderationService = require('../../services/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warns a user and logs the warning.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to warn.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the warning.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const result = await moderationService.warn(interaction, { user, reason });

        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });

        await interaction.reply({ embeds: [result.embed], flags: MessageFlags.Ephemeral });
    },
};
