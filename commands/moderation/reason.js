const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { updateModerationCaseReason } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reason')
        .setDescription('Updates the reason on a moderation case.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(option => option.setName('case_id').setDescription('The case ID to update.').setMinValue(1).setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The new case reason.').setMinLength(1).setMaxLength(1000).setRequired(true)),

    async execute(interaction) {
        const caseId = interaction.options.getInteger('case_id', true);
        const reason = interaction.options.getString('reason', true);
        const updated = await updateModerationCaseReason(interaction.guild.id, caseId, reason);

        if (!updated) {
            return interaction.reply({ content: `Case #${caseId} was not found.`, flags: 64 });
        }

        return interaction.reply({ content: `Case #${caseId} reason updated.`, flags: 64 });
    },
};
