const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { buildUserInfoEmbed } = require('../utility/userinfo');

module.exports = {
    category: 'Context',
    data: new ContextMenuCommandBuilder()
        .setName('User Information')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false),

    async execute(interaction) {
        const user = interaction.targetUser;
        const embed = await buildUserInfoEmbed(interaction.guild, user);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
