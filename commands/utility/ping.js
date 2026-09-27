const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with the bot ping.'),

    async execute(interaction) {
        const embed = createEmbed({
            title: 'Ping',
            description: `Ping is: ${interaction.client.ws.ping}ms`,
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
