const { SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { getConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Suggest a feature for the server.')
        .setDMPermission(false)
        .addStringOption(option => option.setName('suggestion').setDescription('The suggestion you want to make.').setRequired(true)),

    async execute(interaction) {
        const config = getConfig();
        const suggestion = interaction.options.getString('suggestion', true);
        const user = interaction.user;

        if (!config.suggestionID) {
            return interaction.reply({ content: language.suggestions.missingChannel, ephemeral: true });
        }

        const embed = createEmbed({
            title: language.suggestions.title,
            description: `**Suggestion:**\n${suggestion}`,
            thumbnail: user.displayAvatarURL({ dynamic: true }),
            color: 'blue',
            footerText: `Suggested by ${user.tag}`,
        });

        try {
            const suggestionChannel = await interaction.client.channels.fetch(config.suggestionID);
            if (!suggestionChannel?.send) {
                return interaction.reply({ content: language.suggestions.missingChannel, ephemeral: true });
            }

            const message = await suggestionChannel.send({ embeds: [embed] });

            await message.react('✅');
            await message.react('❌');
            await message.startThread({
                name: `Suggestion by ${user.tag}`.slice(0, 100),
                reason: 'Creating a thread for the suggestion.',
            });

            await interaction.reply({ content: language.suggestions.submitted, ephemeral: true });
        } catch (error) {
            console.error('Error sending suggestion:', error);
            await interaction.reply({ content: language.suggestions.failed, ephemeral: true });
        }
    },
};
