const { SlashCommandBuilder } = require('discord.js');
const { blue } = require('../../colors.json');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands')
        .addStringOption(option => option.setName('command').setDescription('The command to get help for')),
    async execute(interaction) {
        if (interaction.options.getString('command')) {
            const commandName = interaction.options.getString('command');
            const command = interaction.client.commands.get(commandName);

            if (!command) {
                return await interaction.reply({ content: 'That command does not exist.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Help for **${commandName}** command`)
                .setDescription(`**Description:**\n${command.data.description}`)
                .setColor(blue)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }else{

        const commandCategories = fs.readdirSync("./commands").filter(file => fs.lstatSync(path.join("./commands", file)).isDirectory());
        const embed = new EmbedBuilder()
            .setTitle('Help 📚')
            .setColor(blue)
            .setTimestamp();

        commandCategories.forEach(category => {
            const categoryCommands = fs.readdirSync(`./commands/${category}`).filter(file => file.endsWith('.js'));
            const commands = categoryCommands.map(command => {
                const commandName = require(`../${category}/${command}`).data.name;
                return commandName;
            });
            embed.addFields({ name: category.charAt(0).toUpperCase() + category.slice(1), value: commands.join(', ') });
        });

        await interaction.reply({ embeds: [embed] });
    }
    },
};
