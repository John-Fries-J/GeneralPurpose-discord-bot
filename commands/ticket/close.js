const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { closeTicket } = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDescription('Closes the ticket.'),

    async execute(interaction) {
        return closeTicket(interaction);
    },
};
