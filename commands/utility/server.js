const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

function formatDate(date) {
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
        .setName('server')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDescription('Provides information about the server.'),

    async execute(interaction) {
        const guild = interaction.guild;
        const embed = createEmbed({
            title: 'Server Info',
            description: `**Server name:** ${guild.name} *(ID: ${guild.id})*\n**Server owner:** <@${guild.ownerId}>\n**Members:** ${guild.memberCount}\n**Created:** ${formatDate(guild.createdAt)}`,
            thumbnail: guild.iconURL(),
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
