const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays all the commands available'),
    async execute(interaction) {

        const commands = fs.readdirSync(path.join(__dirname)).filter(file => file.endsWith('.js'));
        const embed = new MessageEmbed()
            .setTitle('Commands')
            .setColor('RANDOM')
            .setTimestamp();

        for (const file of commands) {
            const command = require(`./${file}`);
            embed.addField(command.data.name, command.data.description);
        }

        await interaction.reply({ embeds: [embed] });
    }
}


