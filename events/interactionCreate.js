const { Events } = require('discord.js');
const language = require('../utils/language');
const { safeReply } = require('../utils/discord');
const { isCommandEnabled } = require('../utils/features');
const { memberCanUseCommand } = require('../utils/permissions');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        if (!isCommandEnabled(command)) {
            return interaction.reply({ content: 'That command is currently disabled.', flags: 64 });
        }

        if (!memberCanUseCommand(interaction, command)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            await safeReply(interaction, { content: language.general.commandError, flags: 64 });
        }
    },
};
