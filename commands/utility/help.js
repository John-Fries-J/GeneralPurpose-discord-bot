const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
        .setTitle('Help 📚')
        .setDescription('Here is a list of all available commands')
        .setColor(blue)
        .setTimestamp();

        const commmandCategries = fs.readdirSync(path.join(__dirname, '../../commands'), {withFileTypes: true })
        .filter(dir => dir.isDirectory())
        .map(dir => dir.name);

        const getCommandsFromDirectory = (directory) => {
            const commandFiles = fs.readdirSync(directory).filter(file => file.endsWith('.js'));
            (async () => {
                for (const file of commandFiles) {
                    const command = require(path.join(directory, file));
                    if (command.data && command.data instanceof SlashCommandBuilder) {
                        const { name, description } = command.data.toJSON();
                        embed.addField(`/${name}`, description);
                    }
                }
                for (const category of commandCategories) {
                    embed.addField(`**${category}**`, '\u200B'); // Add category title
                    const categoryDirectory = path.join(__dirname, `../../commands/${category}`);
                    getCommandsFromDirectory(categoryDirectory); // Fetch commands for the category
                }

                await interaction.reply({ embeds: [embed] });
            })();
    }
    },
};