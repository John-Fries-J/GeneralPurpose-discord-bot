const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createTicketPanel } = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket embed with a button to open a ticket.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to send the ticket embed to.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The support role that can access tickets.')
                .setRequired(true))
        .addChannelOption(option =>
            option
                .setName('category')
                .setDescription('The category to create tickets under.')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)),

    async execute(interaction) {
        const ticketChannel = interaction.options.getChannel('channel', true);
        const ticketRole = interaction.options.getRole('role', true);
        const ticketCategory = interaction.options.getChannel('category', true);

        return createTicketPanel(interaction, ticketChannel, ticketRole, ticketCategory);
    },
};
