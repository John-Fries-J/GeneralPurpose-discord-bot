const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require('discord.js');
const {
    createCommandHelpPayload,
    createMainHelpPayload,
} = require('../../utils/helpSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option => option.setName('command').setDescription('The command to get help for.')),

    async execute(interaction) {
        const commandName = interaction.options.getString('command');

        if (commandName) {
            return interaction.reply(createCommandHelpPayload(interaction, commandName));
        }

        return interaction.reply(createMainHelpPayload(interaction));
    },
};
