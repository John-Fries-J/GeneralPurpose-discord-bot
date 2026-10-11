const { ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getActivityConfig } = require('../../activity/server/auth');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('Show how to open the in-Discord bot control Activity.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const settings = getActivityConfig();
        if (!settings.enabled) {
            return interaction.reply({
                content: 'The Discord Activity control panel is not enabled on this bot.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const components = settings.publicUrl
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setURL(settings.publicUrl)
                    .setLabel('Open Activity URL'),
            )]
            : [];

        return interaction.reply({
            content: [
                'Open the Discord App Launcher in this server and choose this app\'s Launch entry point to start the Activity.',
                settings.publicUrl ? `Activity URL: ${settings.publicUrl}` : null,
            ].filter(Boolean).join('\n'),
            components,
            flags: MessageFlags.Ephemeral,
        });
    },
};
