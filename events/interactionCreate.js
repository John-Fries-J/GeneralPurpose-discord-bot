const { Events } = require('discord.js');
const language = require('../utils/language');
const { safeReply } = require('../utils/discord');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            await safeReply(interaction, { content: language.general.commandError, ephemeral: true });
        }
    },
};
