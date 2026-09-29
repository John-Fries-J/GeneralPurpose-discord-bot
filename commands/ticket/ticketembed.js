const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const {
    addTicketUser,
    claimTicket,
    createTicketPanel,
    listTickets,
    removeTicketUser,
    renameTicket,
    sendTicketTranscript,
    setTicketPriority,
    setTicketTags,
    showTicketStatus,
    unclaimTicket,
} = require('../../utils/tickets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket setup and ticket management.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
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
                .setName('claim')
                .setDescription('Claim the current ticket.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unclaim')
                .setDescription('Clear the current ticket claim.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('priority')
                .setDescription('Set the current ticket priority.')
                .addStringOption(option => option
                    .setName('level')
                    .setDescription('Ticket priority.')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Low', value: 'low' },
                        { name: 'Normal', value: 'normal' },
                        { name: 'High', value: 'high' },
                        { name: 'Urgent', value: 'urgent' },
                    )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('tags')
                .setDescription('Set comma-separated tags for the current ticket.')
                .addStringOption(option => option.setName('tags').setDescription('Comma-separated tags. Empty clears tags.').setMaxLength(160).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show metadata for the current ticket.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List recent ticket metadata.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transcript')
                .setDescription('Generate a transcript for the current ticket.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
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

        if (subcommand === 'claim') {
            return claimTicket(interaction);
        }

        if (subcommand === 'unclaim') {
            return unclaimTicket(interaction);
        }

        if (subcommand === 'priority') {
            return setTicketPriority(interaction, interaction.options.getString('level', true));
        }

        if (subcommand === 'tags') {
            return setTicketTags(interaction, interaction.options.getString('tags', true));
        }

        if (subcommand === 'status') {
            return showTicketStatus(interaction);
        }

        if (subcommand === 'list') {
            return listTickets(interaction);
        }

        if (subcommand === 'transcript') {
            return sendTicketTranscript(interaction);
        }
    },
};
