const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { getConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { formatTemplate } = require('../../utils/template');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Suggest a feature for the server.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option =>
            option
                .setName('suggestion')
                .setDescription('The suggestion you want to make.')
                .setMinLength(3)
                .setMaxLength(1900)
                .setRequired(true)),

    async execute(interaction) {
        const config = getConfig();
        const suggestion = interaction.options.getString('suggestion', true);
        const user = interaction.user;

        if (!config.suggestionID) {
            return interaction.reply({ content: language.suggestions.missingChannel, flags: 64 });
        }

        if (suggestion.length > 1900) {
            return interaction.reply({ content: language.suggestions.tooLong, flags: 64 });
        }

        const embed = createEmbed({
            title: language.suggestions.title,
            description: suggestion,
            thumbnail: user.displayAvatarURL({ dynamic: true }),
            color: 'blue',
            fields: [
                { name: 'Suggested by', value: `<@${user.id}>`, inline: true },
                { name: 'User ID', value: user.id, inline: true },
            ],
            footerText: `Suggested by ${user.tag}`,
        });

        try {
            const suggestionChannel = await interaction.client.channels.fetch(config.suggestionID);
            if (!suggestionChannel?.send) {
                return interaction.reply({ content: language.suggestions.missingChannel, flags: 64 });
            }

            const message = await suggestionChannel.send({ embeds: [embed] });
            await message.react('\u2705');
            await message.react('\u274c');
            await message.startThread({
                name: formatTemplate(language.suggestions.threadName, { user: user.tag }).slice(0, 100),
                reason: 'Creating a thread for the suggestion.',
            });

            await sendLog(interaction.guild, {
                type: 'suggestion',
                title: 'Suggestion submitted',
                color: 'blue',
                user,
                fields: [
                    { name: 'User', value: formatUser(user), inline: true },
                    { name: 'Channel', value: `<#${suggestionChannel.id}>`, inline: true },
                    { name: 'Suggestion', value: suggestion.slice(0, 1024) },
                ],
            }).catch(() => null);

            await interaction.reply({ content: language.suggestions.submitted, flags: 64 });
        } catch (error) {
            console.error('Error sending suggestion:', error);
            await interaction.reply({ content: language.suggestions.failed, flags: 64 });
        }
    },
};
