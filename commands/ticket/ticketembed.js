const { MessageEmbed, Permissions } = require('discord.js');
const config = require('../../config.json');
//need to create a ticket channel in the config.json file

module.exports = {
    name: 'ticket',
    description: 'Create a ticket embed with a button to open a ticket',
    async execute(message, args) {
        const ticketEmbed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Ticket')
            .setDescription('Click the button below to open a ticket.')
            .addField('Ticket Creator', message.author.tag)
            .setTimestamp();

        const ticketchannel = config.ticketChannel
        const channel = ticketchannel
        const ticketMessage = await message.channel.send({ embeds: [ticketEmbed] });

        ticketMessage.react('🎫');
        // need to make it a button but its a good start. The button will need to be made in or handled in the events folder anyway. Cant do on laptop.
    },
};