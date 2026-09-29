const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createUserHistoryPayload } = require('../../utils/userHistoryView');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Shows database-backed history for a user.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        return interaction.reply({
            ...await createUserHistoryPayload(interaction.guild.id, user),
            flags: MessageFlags.Ephemeral,
        });
    },
};
