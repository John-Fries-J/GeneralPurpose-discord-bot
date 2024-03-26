const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

module.exports = {

    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Checks the ping of the bot'),
    async execute(interaction) {
            
            const embed = new MessageEmbed()
                .setTitle('Pong! 🏓')
                .setColor('RANDOM')
                .setDescription(`Ping: ${interaction.client.ws.ping}ms`)
                .setTimestamp();
    
            await interaction.reply({ embeds: [embed] });
        }
}