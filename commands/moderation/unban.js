const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { logModerationAction } = require('../../utils/moderation');
const { removeTempBan } = require('../../utils/store');

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

        try {
            const user = await interaction.guild.members.unban(userId, reason);
            await removeTempBan(interaction.guild.id, userId);
            await logModerationAction(interaction, {
                caseType: 'unban',
                title: 'User unbanned',
                color: 'green',
                user,
                reason,
            });
            await interaction.reply({ content: `${user.tag} has been unbanned. ${language.moderation.caseLogged}`, flags: 64 });
        } catch (error) {
            console.error('Unban failed:', error);
            await interaction.reply({ content: 'I could not unban that user. Make sure the ID is correct and the user is banned.', flags: 64 });
        }
    },
};
