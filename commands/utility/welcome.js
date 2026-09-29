const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { formatTemplate } = require('../../utils/template');
const { getGuildSettings } = require('../../utils/guildConfig');

function configuredValue(source, key, fallback) {
    return Object.prototype.hasOwnProperty.call(source || {}, key) ? source[key] : fallback;
}

function formatWelcomeTemplate(template, values) {
    return formatTemplate(template, values).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function buildWelcomeEmbed(user, guild, settings = null) {
    const welcome = settings || language.welcome;
    const description = formatWelcomeTemplate(configuredValue(welcome, 'description', language.welcome.description), {
        user: user ? `<@${user.id}>` : 'there',
        username: user?.username || 'there',
        server: guild?.name || 'this server',
        memberCount: `${guild?.memberCount ?? guild?.members?.cache?.size ?? ''}`,
    });

    return createEmbed({
        title: configuredValue(welcome, 'title', language.welcome.title),
        description,
        thumbnail: welcome.thumbnail,
        footerText: configuredValue(welcome, 'footer', language.welcome.footer),
        footerIcon: guild?.iconURL?.() || undefined,
        color: 'blue',
    });
}

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Sends the welcome embed.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(option => option.setName('user').setDescription('Ping the user with the message.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const config = await getGuildSettings(interaction.guild.id);
        const embed = buildWelcomeEmbed(user, interaction.guild, config.WelcomeEmbed);

        if (user) {
            await interaction.channel.send({ content: `<@${user.id}>`, embeds: [embed] });
            return interaction.reply({
                content: formatTemplate(language.welcome.sent, { user: `<@${user.id}>` }),
                flags: 64,
            });
        }

        await interaction.reply({ embeds: [embed] });
    },
    buildWelcomeEmbed,
};
