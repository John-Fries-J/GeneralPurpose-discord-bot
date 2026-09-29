const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { fetchMember } = require('../../utils/discord');

function formatDate(date) {
    if (!date) return 'Unknown';

    return date.toLocaleString('en-GB', {
        timeZone: 'GMT',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    });
}

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('Provides information about a user.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addUserOption(option => option.setName('user').setDescription('Gather info about another user.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = await fetchMember(interaction.guild, user.id);

        const embed = createEmbed({
            title: 'User Info',
            description: `**User name:** ${user.tag} *(ID: ${user.id})*\n**Account created:** ${formatDate(user.createdAt)}\n**Joined ${interaction.guild.name}:** ${formatDate(member?.joinedAt)}`,
            thumbnail: user.displayAvatarURL({ dynamic: true }),
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
