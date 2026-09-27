const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { closeTicket } = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDescription('Closes the ticket.'),

    async execute(interaction) {
        return closeTicket(interaction);
    },
};
