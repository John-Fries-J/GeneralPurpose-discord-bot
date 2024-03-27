const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Suggest a feature for the server.')
        .addStringOption(option => option.setName('suggestion').setDescription('The suggestion you want to make.').setRequired(true)),
    async execute(interaction) {
        const suggestion = interaction.options.getString('suggestion');
        const user = interaction.user;
        const embed = new EmbedBuilder()
            .setThumbnail(user.avatarURL())
            .setDescription(`**Submitter:**\n ${user.tag} \n\n**Suggestion**\n${suggestion}`)
            .setColor(blue)
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    },
};