const { Events } = require('discord.js');
const { closeTicket, customIds, deleteTicket, openTicket } = require('../utils/tickets');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton() || !interaction.guild) return;

        if (interaction.customId === customIds.open || interaction.customId === 'open_ticket') {
            return openTicket(interaction);
        }

        if (interaction.customId === customIds.close || interaction.customId === 'close_ticket') {
            return closeTicket(interaction);
        }

        if (interaction.customId === customIds.delete || interaction.customId === 'delete_ticket') {
            return deleteTicket(interaction);
        }
    },
};
