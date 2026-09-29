const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { listModerationCases } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('Lists moderation cases for a user.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const cases = (await listModerationCases(interaction.guild.id, { userId: user.id })).slice(0, 10);

        if (!cases.length) {
            return interaction.reply({ content: `${user.tag} has no moderation cases.`, flags: 64 });
        }

        const embed = createEmbed({
            title: `Cases for ${user.tag}`,
            color: 'orange',
            description: cases.map(record => {
                const status = record.active === false ? 'cleared' : 'active';
                return `#${record.id} ${record.type} (${status}) - ${record.reason || 'No reason'}`;
            }).join('\n'),
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
