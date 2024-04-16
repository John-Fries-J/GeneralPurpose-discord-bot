const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Provides the avatar of the user or mentioned user.')
        .addUserOption(option => option.setName('user').setDescription('The user to get the avatar of.')),
    async execute(interaction) {
        let user = interaction.options.getUser('user') || interaction.user;
        let mentionedUser = interaction.options.getMember('user');
        const embed = new EmbedBuilder()
            .setColor(blue)
            .setTimestamp();
        if (mentionedUser) {
            user = mentionedUser.user;
            embed.setTitle(`${user.tag}'s Avatar`);
        } else {
            embed.setTitle(`${interaction.user.tag}'s Avatar`);
        }
        embed.setImage(user.avatarURL({ dynamic: true }));
        await interaction.reply({ embeds: [embed] });
    },
};