const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Deletes a ticket.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!interaction.channel?.name?.startsWith('closed-')) {
            return interaction.reply({ content: language.tickets.notClosedTicket, ephemeral: true });
        }

        await interaction.reply({ content: 'Deleting ticket...', ephemeral: true });
        await interaction.channel.delete();
    },
};
