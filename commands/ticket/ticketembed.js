const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, PermissionFlagsBits, ButtonStyle, ChannelType } = require('discord.js');
const language = require('../../utils/language');
const { updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { formatTemplate } = require('../../utils/template');
const { isGuildTextChannel } = require('../../utils/discord');

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
        const ticketCategory = interaction.options.getChannel('category', true);
        const ticketRole = interaction.options.getRole('role', true);
        const ticketChannel = interaction.options.getChannel('channel', true);

        if (!isGuildTextChannel(ticketChannel)) {
            return interaction.reply({ content: 'Please choose a normal text channel for the ticket panel.', ephemeral: true });
        }

        const ticketEmbed = createEmbed({
            title: language.tickets.panelTitle,
            description: language.tickets.panelDescription,
            color: 'red',
        });

        const ticketButton = new ButtonBuilder()
            .setLabel(language.tickets.openButton)
            .setStyle(ButtonStyle.Primary)
            .setCustomId('open_ticket');

        const message = await ticketChannel.send({
            embeds: [ticketEmbed],
            components: [new ActionRowBuilder().addComponents(ticketButton)],
        });

        updateConfig(config => {
            config.ticketMessageID = message.id;
            config.ticketChannelId = ticketChannel.id;
            config.ticketCategoryId = ticketCategory.id;
            config.ticketRole = ticketRole.id;
            return config;
        });

        await interaction.reply({
            content: formatTemplate(language.tickets.setupComplete, { channel: `<#${ticketChannel.id}>` }),
            ephemeral: true,
        });
    },
};
