const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { logModerationAction, sendModerationDm, validateTarget } = require('../../utils/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warns a user and logs the warning.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to warn.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the warning.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const target = await validateTarget(interaction, user);

        if (!target.ok) {
            return interaction.reply({ content: target.message, ephemeral: true });
        }

        const dmSent = await sendModerationDm(user, {
            title: 'User Warned',
            description: `You have been warned in **${interaction.guild.name}**.\n**Reason:** ${reason}`,
            color: 'orange',
        });

        await logModerationAction(interaction, {
            title: 'User warned',
            color: 'orange',
            user,
            reason,
            extraFields: [{ name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true }],
        });

        const embed = createEmbed({
            title: 'User Warned',
            description: `**${user.tag}** has been warned.\n**Reason:** ${reason}`,
            color: 'orange',
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
