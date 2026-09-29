const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('member')
        .setDescription('Lists members within a role.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addRoleOption(option => option.setName('role').setDescription('The role to list members from.').setRequired(true)),

    async execute(interaction) {
        const role = interaction.options.getRole('role', true);
        await interaction.guild.members.fetch();

        const mentions = role.members
            .map(member => `<@${member.id}>`)
            .slice(0, 90);

        const embed = createEmbed({
            title: `Members with ${role.name}`,
            description: mentions.join('\n') || 'No members found with this role.',
            color: 'blue',
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
