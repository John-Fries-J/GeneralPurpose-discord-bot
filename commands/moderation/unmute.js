const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { logModerationAction, sendModerationDm, validateTarget } = require('../../utils/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmutes a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to unmute.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the unmute.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Unmuted';
        const target = await validateTarget(interaction, user, 'moderatable');

        if (!target.ok) {
            return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotUnmute : target.message, ephemeral: true });
        }

        await target.member.timeout(null, reason);

        const embed = createEmbed({
            title: 'User Unmuted',
            description: `**${target.member.user.tag}** has been unmuted.`,
            color: 'green',
        });

        const dmSent = await sendModerationDm(user, {
            title: 'User Unmuted',
            description: `You have been unmuted in **${interaction.guild.name}**.\n**Reason:** ${reason}`,
            color: 'green',
        });

        await logModerationAction(interaction, {
            title: 'User unmuted',
            color: 'green',
            user,
            reason,
            extraFields: [{ name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true }],
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
