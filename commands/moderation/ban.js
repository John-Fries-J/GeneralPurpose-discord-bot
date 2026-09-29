const { InteractionContextType, ApplicationIntegrationType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { safeReply } = require('../../utils/discord');
const moderationService = require('../../services/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to ban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban.'))
        .addStringOption(option => option.setName('duration').setDescription('Optional duration, such as 1d or 2h.'))
        .addIntegerOption(option => option.setName('delete_days').setDescription('Delete message history from the past 0-7 days.').setMinValue(0).setMaxValue(7)),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const duration = interaction.options.getString('duration');
        const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
        const result = await moderationService.ban(interaction, { user, reason, duration, deleteDays });

        await safeReply(interaction, { content: result.ok ? result.content : result.message });
    },
};
