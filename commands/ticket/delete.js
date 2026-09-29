const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { deleteTicket } = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Deletes a ticket.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        return deleteTicket(interaction);
    },
};
