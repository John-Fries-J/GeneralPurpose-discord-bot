const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const {
    addTicketUser,
    createTicketPanel,
    removeTicketUser,
    renameTicket,
    sendTicketTranscript,
} = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket setup and ticket management.')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Create a ticket embed with a button to open a ticket.')
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
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a user to the current ticket.')
                .addUserOption(option => option.setName('user').setDescription('The user to add.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a user from the current ticket.')
                .addUserOption(option => option.setName('user').setDescription('The user to remove.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rename')
                .setDescription('Rename the current ticket.')
                .addStringOption(option => option.setName('name').setDescription('The new ticket name.').setMinLength(2).setMaxLength(80).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transcript')
                .setDescription('Generate a transcript for the current ticket.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'You need Administrator permission to set up tickets.', ephemeral: true });
            }

            return createTicketPanel(
                interaction,
                interaction.options.getChannel('channel', true),
                interaction.options.getRole('role', true),
                interaction.options.getChannel('category', true),
            );
        }

        if (subcommand === 'add') {
            return addTicketUser(interaction, interaction.options.getUser('user', true));
        }

        if (subcommand === 'remove') {
            return removeTicketUser(interaction, interaction.options.getUser('user', true));
        }

        if (subcommand === 'rename') {
            return renameTicket(interaction, interaction.options.getString('name', true));
        }

        if (subcommand === 'transcript') {
            return sendTicketTranscript(interaction);
        }
    },
};
