const { InteractionContextType, ApplicationIntegrationType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const moderationService = require('../../services/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to kick.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the kick.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const result = await moderationService.kick(interaction, { user, reason });

        if (!result.ok) return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });

        await interaction.reply({ content: result.content, flags: MessageFlags.Ephemeral });
    },
};
