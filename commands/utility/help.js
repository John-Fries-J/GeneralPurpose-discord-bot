const { SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { memberCanUseCommand } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands.')
        .addStringOption(option => option.setName('command').setDescription('The command to get help for.')),

    async execute(interaction) {
        const commandName = interaction.options.getString('command');
        const commands = interaction.client.commands;

        if (commandName) {
            const command = commands.get(commandName);
            if (!command) {
                return interaction.reply({ content: language.help.missingCommand, flags: 64 });
            }

            if (!memberCanUseCommand(interaction, command)) {
                return interaction.reply({ content: language.help.missingCommand, flags: 64 });
            }

            const fields = [];
            const options = command.data.options || [];
            if (options.length > 0) {
                fields.push({
                    name: 'Options',
                    value: options.map(option => `**${option.name}:** ${option.description}`).join('\n'),
                });
            }

            const embed = createEmbed({
                title: `Help for /${commandName}`,
                description: command.data.description,
                fields,
                color: 'blue',
            });

            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        const categories = new Map();
        for (const command of commands.values()) {
            if (!memberCanUseCommand(interaction, command)) continue;

            const category = command.category || 'General';
            const current = categories.get(category) || [];
            current.push(`**/${command.data.name}:** ${command.data.description}`);
            categories.set(category, current);
        }

        const fields = [...categories.entries()].map(([category, categoryCommands]) => ({
            name: category,
            value: categoryCommands.sort().join('\n').slice(0, 1024),
        }));

        const embed = createEmbed({
            title: language.help.title,
            fields,
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
