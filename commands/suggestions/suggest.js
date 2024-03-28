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
        const channel = interaction.guild.channels.cache.find(channel => channel.name === 'suggestions');
        if (!channel) {
            await interaction.reply({ content: 'Could not find a channel named suggestions. Pester the bot devs to make one', ephemeral: true });
            return;
        }
        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: 'Suggestion submitted!', ephemeral: true });
    },
};
