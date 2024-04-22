const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands')
        .addStringOption(option => option.setName('command').setDescription('The command to get help for')),
    async execute(interaction) {
        const commandName = interaction.options.getString('command');
        const commands = interaction.client.commands;

        if (commandName) {
            const command = commands.get(commandName);
            if (!command) {
                return await interaction.reply({ content: 'That command does not exist.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Help for **${commandName}** command`)
                .setDescription(`**Description:**\n${command.data.description}`);

            if (command.data.options && command.data.options.length > 0) {
                const optionsDescription = command.data.options.map(option => {
                    return `**${option.name}:** ${option.description}`;
                }).join('\n');
                embed.addFields({ name: 'Options', value: optionsDescription });
            }

            await interaction.reply({ embeds: [embed.setColor(blue).setTimestamp()] });
        } else {
            const commandCategories = fs.readdirSync("./commands").filter(file => fs.lstatSync(path.join("./commands", file)).isDirectory());
            const embed = new EmbedBuilder()
                .setTitle('Help 📚')
                .setColor(blue)
                .setTimestamp();

            commandCategories.forEach(category => {
                const categoryCommands = fs.readdirSync(`./commands/${category}`).filter(file => file.endsWith('.js'));
                const commands = categoryCommands.map(command => {
                    const commandName = require(`../${category}/${command}`).data.name;
                    const commandDescription = require(`../${category}/${command}`).data.description;
                    return `**${commandName}:** ${commandDescription}`;
                });
                embed.addFields({ name: "**__" + category.charAt(0).toUpperCase() + category.slice(1) + ":__**", value: commands.join('\n') });
            });

            await interaction.reply({ embeds: [embed] });
        }
    },
};
