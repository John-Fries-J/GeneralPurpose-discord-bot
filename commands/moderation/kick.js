const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { logModerationAction, sendModerationDm, validateTarget } = require('../../utils/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to kick.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the kick.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const target = await validateTarget(interaction, user, 'kickable');

        if (!target.ok) {
            return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotKick : target.message, ephemeral: true });
        }

        const dmSent = await sendModerationDm(user, {
            title: 'User Kicked',
            description: `You have been kicked from **${interaction.guild.name}**.\n**Reason:** ${reason}`,
            color: 'red',
        });

        await target.member.kick(reason);
        await logModerationAction(interaction, {
            title: 'User kicked',
            color: 'red',
            user,
            reason,
            extraFields: [{ name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true }],
        });

        await interaction.reply({
            content: `User ${user.tag} has been kicked. Reason: ${reason}${dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
            ephemeral: true,
        });
    },
};
