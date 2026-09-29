const { InteractionContextType, ApplicationIntegrationType, ApplicationCommandType, ContextMenuCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { showAddModeratorNoteModal } = require('../../utils/moderationContext');

module.exports = {
    category: 'Context',
    data: new ContextMenuCommandBuilder()
        .setName('Add Moderator Note')
        .setType(ApplicationCommandType.User)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        return showAddModeratorNoteModal(interaction);
    },
};
