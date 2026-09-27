const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { parseDuration } = require('../../utils/duration');
const { createEmbed } = require('../../utils/embeds');
const { upsertTempMute } = require('../../utils/store');
const { getOrCreateMuteRole, logModerationAction, muteMemberWithRole, sendModerationDm, validateTarget } = require('../../utils/moderation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to mute.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration, such as 10m, 2h, 3d, or 1w.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the mute.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const duration = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const durationInMs = parseDuration(duration);
        const target = await validateTarget(interaction, user, 'moderatable');

        if (!target.ok) {
            return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotMute : target.message, flags: 64 });
        }

        if (!durationInMs) {
            return interaction.reply({ content: language.moderation.invalidDuration, flags: 64 });
        }

        const muteRole = await getOrCreateMuteRole(interaction.guild);
        const removedRoleIds = await muteMemberWithRole(target.member, muteRole);
        const expiresAt = Date.now() + durationInMs;

        await upsertTempMute({
            guildId: interaction.guild.id,
            userId: user.id,
            reason,
            moderatorId: interaction.user.id,
            removedRoleIds,
            muteRoleId: muteRole.id,
            expiresAt,
            createdAt: Date.now(),
        });

        const embed = createEmbed({
            title: 'User Muted',
            description: `**${target.member.user.tag}** has been muted for ${duration}.\n**Reason:** ${reason}`,
            color: 'orange',
        });

        const dmSent = await sendModerationDm(user, {
            title: 'User Muted',
            description: `You have been muted in **${interaction.guild.name}** for ${duration}.\n**Reason:** ${reason}`,
            color: 'orange',
        });

        await logModerationAction(interaction, {
            caseType: 'mute',
            title: 'User muted',
            color: 'orange',
            user,
            reason,
            duration,
            extraFields: [
                { name: 'Duration', value: duration, inline: true },
                { name: 'Removed roles', value: `${removedRoleIds.length}`, inline: true },
                { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
            ],
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
    },
};
