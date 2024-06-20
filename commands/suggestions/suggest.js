const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('@discordjs/builders');
const { blue } = require('../../colors.json');
const { suggestionID } = require('../../config.json');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Suggest a feature for the server.')
        .addStringOption(option => option.setName('suggestion').setDescription('The suggestion you want to make.').setRequired(true)),
    async execute(interaction) {
        const suggestion = interaction.options.getString('suggestion');
        const user = interaction.user;
        const embed = new EmbedBuilder()
            .setTitle(`Suggestion`)
            .setDescription(`**Suggestion:**\n${suggestion}`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setColor(parseInt(blue.replace('#', ''), 16))
            .setFooter({ text: 'Suggested by ' + user.tag });
        try {
            const suggestionChannel = await interaction.client.channels.fetch(suggestionID);
            const message = await suggestionChannel.send({ embeds: [embed] });
            await message.react('✅'); 
            await message.react('❌'); 
            await interaction.reply({ content: 'Your suggestion has been submitted!', ephemeral: true });
        } catch (error) {
            console.error('Error sending suggestion:', error);
            await interaction.reply({ content: 'Failed to submit suggestion. Please try again later.', ephemeral: true });
        }
    },
};
