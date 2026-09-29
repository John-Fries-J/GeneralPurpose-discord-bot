const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createSetupPayload } = require('../../utils/setupWizard');

module.exports = {
    category: 'config',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Open the interactive server setup wizard.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        return interaction.reply(await createSetupPayload(interaction));
    },
};
