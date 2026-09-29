const { InteractionContextType, ApplicationIntegrationType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { safeReply } = require('../../utils/discord');
const moderationService = require('../../services/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a user from the server.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to mute.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration, such as 10m, 2h, 3d, or 1w.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the mute.')),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const user = interaction.options.getUser('user', true);
        const duration = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const result = await moderationService.mute(interaction, { user, duration, reason });

        await safeReply(interaction, result.ok ? { embeds: [result.embed] } : { content: result.message });
    },
};
