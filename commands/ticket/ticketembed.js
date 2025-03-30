const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ChannelType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { red } = require('../../colors.json');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket embed with a button to open a ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to send the ticket embed to')
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('role')
                .setDescription('The Support Role ID that you want to have access to the tickets')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('category')
                .setDescription('The category ID you want to have the tickets under')
                .setRequired(true)),

    async execute(interaction) {
        const ticketCategoryId = interaction.options.getChannel('category').id;
        const ticketRole = interaction.options.getRole('role').id;
        const ticketChannelId = interaction.options.getChannel('channel').id;
        const channel = interaction.guild.channels.cache.get(ticketChannelId);

        const ticketEmbed = new EmbedBuilder()
            .setTitle('Ticket')
            .setDescription('Click the button below to open a ticket.')
            .setColor(red)
            .setTimestamp();

        const ticketButton = new ButtonBuilder()
            .setLabel('Open Ticket')
            .setStyle('Primary')
            .setCustomId('open_ticket');

        const message = await channel.send({ 
            embeds: [ticketEmbed], 
            components: [new ActionRowBuilder().addComponents(ticketButton)]
        });

        let config = {};
        if (fs.existsSync('./config.json')) {
            config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        }

        config.ticketMessageID = message.id;
        config.ticketCategoryId = ticketCategoryId;
        config.ticketRole = ticketRole;

        fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));

        interaction.reply({ content: `Ticket embed sent to <#${ticketChannelId}>`, ephemeral: true });
    }
};
