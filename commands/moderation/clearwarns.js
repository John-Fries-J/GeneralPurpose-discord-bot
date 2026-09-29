const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { clearWarningCases } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearwarns')
        .setDescription('Clears active warning cases for a user.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user whose warnings should be cleared.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for clearing warnings.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Warnings cleared';
        const cleared = await clearWarningCases(interaction.guild.id, user.id, interaction.user.id, reason);

        return interaction.reply({
            content: `Cleared ${cleared} active warning case${cleared === 1 ? '' : 's'} for ${user.tag}.`,
            flags: 64,
        });
    },
};
