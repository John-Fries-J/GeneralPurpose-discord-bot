const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const moderationService = require('../../services/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unbans a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addStringOption(option => option.setName('user_id').setDescription('The Discord user ID to unban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the unban.')),

    async execute(interaction) {
        const userId = interaction.options.getString('user_id', true).trim();
        const reason = interaction.options.getString('reason') || 'Unbanned';
        const result = await moderationService.unban(interaction, { userId, reason });

        return interaction.reply({
            content: result.ok ? result.content : result.message,
            flags: MessageFlags.Ephemeral,
        });
    },
};
