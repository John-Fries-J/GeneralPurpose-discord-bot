const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unbans a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addStringOption(option => option.setName('user_id').setDescription('The Discord user ID to unban.').setRequired(true)),

    async execute(interaction) {
        const userId = interaction.options.getString('user_id', true).trim();

        try {
            const user = await interaction.guild.members.unban(userId);
            await interaction.reply({ content: `${user.tag} has been unbanned.`, ephemeral: true });
        } catch (error) {
            console.error('Unban failed:', error);
            await interaction.reply({ content: 'I could not unban that user. Make sure the ID is correct and the user is banned.', ephemeral: true });
        }
    },
};
