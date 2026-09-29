const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { canUseSetup, createSetupPayload } = require('../../utils/setupWizard');

module.exports = {
    category: 'config',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Open the interactive server setup wizard.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!canUseSetup(interaction)) {
            return interaction.reply({ content: 'You need Manage Server permission to use setup controls.', flags: 64 });
        }
        return interaction.reply(await createSetupPayload(interaction));
    },
};
