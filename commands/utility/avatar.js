const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Shows a user or server avatar.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Shows a user avatar.')
                .addUserOption(option => option.setName('user').setDescription('The user to get the avatar of.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('server')
                .setDescription('Shows the server icon.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'server') {
            const icon = interaction.guild.iconURL({ size: 1024 });
            if (!icon) {
                return interaction.reply({ content: 'This server does not have an icon.', flags: 64 });
            }

            const embed = createEmbed({
                title: `${interaction.guild.name}'s Icon`,
                image: icon,
                color: 'blue',
            });

            return interaction.reply({ embeds: [embed] });
        }

        const user = interaction.options.getUser('user') || interaction.user;
        const embed = createEmbed({
            title: `${user.tag}'s Avatar`,
            image: user.displayAvatarURL({ dynamic: true, size: 1024 }),
            color: 'blue',
        });

        return interaction.reply({ embeds: [embed] });
    },
};
