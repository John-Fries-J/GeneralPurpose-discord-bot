const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { createEmbed } = require('../../utils/embeds');
const { getTempMute, removeTempMute } = require('../../utils/store');
const { getOrCreateMuteRole, logModerationAction, restoreMutedMember, sendModerationDm, validateTarget } = require('../../utils/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmutes a user from the server.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to unmute.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the unmute.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Unmuted';
        const target = await validateTarget(interaction, user, 'moderatable');

        if (!target.ok) {
            return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotUnmute : target.message, flags: 64 });
        }

        const muteRecord = await getTempMute(interaction.guild.id, user.id);
        const muteRole = await getOrCreateMuteRole(interaction.guild);
        const restoredRoleIds = await restoreMutedMember(target.member, muteRole, muteRecord?.removedRoleIds || [], reason);
        await removeTempMute(interaction.guild.id, user.id);

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
            caseType: 'unmute',
            title: 'User unmuted',
            color: 'green',
            user,
            reason,
            extraFields: [
                { name: 'Restored roles', value: `${restoredRoleIds.length}`, inline: true },
                { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
            ],
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
