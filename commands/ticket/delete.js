const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Deletes a ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async execute(interaction) {
        if (!interaction.channel.name.startsWith('closed-')) {
            return await interaction.reply({ content: 'You can only use this command in a closed ticket channel', ephemeral: true });
        }
        await interaction.channel.delete();
    },
};