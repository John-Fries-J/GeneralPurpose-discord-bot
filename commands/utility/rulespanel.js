const { InteractionContextType, ApplicationIntegrationType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { getConfig } = require('../../utils/config');
const { rulesAgreementCustomId } = require('../../utils/community');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rulespanel')
        .setDescription('Post the configured rules agreement panel.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const config = getConfig().rulesAgreement || {};
        if (config.enabled !== true || !config.roleId) {
            return interaction.reply({ content: 'Configure rulesAgreement.enabled and rulesAgreement.roleId first.', flags: 64 });
        }

        const embed = createEmbed({
            title: config.title || 'Server Rules',
            description: config.description || 'Read the server rules, then click the button below to agree.',
            color: config.color || 'blue',
        });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(rulesAgreementCustomId)
                .setLabel(config.buttonLabel || 'I agree')
                .setStyle(ButtonStyle.Success),
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Rules agreement panel posted.', flags: 64 });
    },
};
