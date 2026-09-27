const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { deleteTicket } = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Deletes a ticket.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        return deleteTicket(interaction);
    },
};
