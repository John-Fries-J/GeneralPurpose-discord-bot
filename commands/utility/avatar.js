const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Provides the avatar of the user or mentioned user.')
        .addUserOption(option => option.setName('user').setDescription('The user to get the avatar of.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const embed = createEmbed({
            title: `${user.tag}'s Avatar`,
            image: user.displayAvatarURL({ dynamic: true, size: 1024 }),
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed] });
    },
};
