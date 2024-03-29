const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
        .setTitle('Help 📚')
        .setDescription('Here is a list of all available commands')
        .setColor(blue)
        .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    },
};