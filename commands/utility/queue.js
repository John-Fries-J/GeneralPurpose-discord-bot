const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { getQueueSummary } = require('../../utils/music');
const { createQueuePayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        return interaction.reply(createQueuePayload(getQueueSummary(interaction.guild.id)));
    },
};
