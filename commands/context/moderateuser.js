const { InteractionContextType, ApplicationIntegrationType, ApplicationCommandType, ContextMenuCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { showModerateUserInterface } = require('../../utils/moderationContext');

module.exports = {
    category: 'Context',
    data: new ContextMenuCommandBuilder()
        .setName('Moderate User')
        .setType(ApplicationCommandType.User)
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        return showModerateUserInterface(interaction);
    },
};
