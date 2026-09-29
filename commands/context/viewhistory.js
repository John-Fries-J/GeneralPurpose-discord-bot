const { InteractionContextType, ApplicationIntegrationType, ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createUserHistoryPayload } = require('../../utils/userHistoryView');

module.exports = {
    category: 'Context',
    data: new ContextMenuCommandBuilder()
        .setName('View History')
        .setType(ApplicationCommandType.User)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        return interaction.reply({
            ...await createUserHistoryPayload(interaction.guild.id, interaction.targetUser),
            flags: MessageFlags.Ephemeral,
        });
    },
};
