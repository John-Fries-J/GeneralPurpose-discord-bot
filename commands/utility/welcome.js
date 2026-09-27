const { SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { formatTemplate } = require('../../utils/template');

function buildWelcomeEmbed(user, guild) {
    const welcome = language.welcome;
    const description = formatTemplate(welcome.description, {
        user: user ? `<@${user.id}>` : 'there',
    });

    return createEmbed({
        title: welcome.title,
        description,
        thumbnail: welcome.thumbnail,
        footerText: welcome.footer,
        footerIcon: guild?.iconURL() || undefined,
        color: 'blue',
    });
}

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Sends the welcome embed.')
        .setDMPermission(false)
        .addUserOption(option => option.setName('user').setDescription('Ping the user with the message.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const embed = buildWelcomeEmbed(user, interaction.guild);

        if (user) {
            await interaction.channel.send({ content: `<@${user.id}>`, embeds: [embed] });
            return interaction.reply({
                content: formatTemplate(language.welcome.sent, { user: `<@${user.id}>` }),
                ephemeral: true,
            });
        }

        await interaction.reply({ embeds: [embed] });
    },
    buildWelcomeEmbed,
};
