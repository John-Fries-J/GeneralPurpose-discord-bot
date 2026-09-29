const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with the bot ping.')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall),

    async execute(interaction) {
        const embed = createEmbed({
            title: 'Ping',
            description: `Ping is: ${interaction.client.ws.ping}ms`,
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
