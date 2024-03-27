const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { red } = require('../../colors.json');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket embed with a button to open a ticket'),
    async execute(interaction) {
        const ticketEmbed = new EmbedBuilder()
            .setTitle('Ticket')
            .setDescription('Click the button below to open a ticket.')
            .setColor(red)
            .setTimestamp();


        const ticketChannelId = config.ticketChannel;
        const channel = interaction.guild.channels.cache.get(ticketChannelId);
        const ticketMessage = await channel.send({ embeds: [ticketEmbed] });

        interaction.reply({ content: `Ticket embed has been sent to <#${ticketChannelId}>`, ephemeral: true });

        ticketMessage.react('🎫');
        // need to make it a button but its a good start. The button will need to be made in or handled in the events folder anyway. Cant do on laptop.
    },
};