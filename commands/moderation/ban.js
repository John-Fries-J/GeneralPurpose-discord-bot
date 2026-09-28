const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { parseDuration } = require('../../utils/duration');
const { fetchMember, safeReply } = require('../../utils/discord');
const { logModerationAction, sendModerationDm, validateTarget } = require('../../utils/moderation');
const { upsertTempBan } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to ban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban.'))
        .addStringOption(option => option.setName('duration').setDescription('Optional duration, such as 1d or 2h.'))
        .addIntegerOption(option => option.setName('delete_days').setDescription('Delete message history from the past 0-7 days.').setMinValue(0).setMaxValue(7)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const duration = interaction.options.getString('duration');
        const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
        const member = await fetchMember(interaction.guild, user.id);

        if (duration && !parseDuration(duration)) {
            return safeReply(interaction, { content: language.moderation.invalidDuration });
        }

        if (member) {
            const target = await validateTarget(interaction, user, 'bannable');
            if (!target.ok) {
                return safeReply(interaction, { content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotBan : target.message });
            }
        }

        const dmSent = await sendModerationDm(user, {
            title: 'User Banned',
            description: `You have been banned from **${interaction.guild.name}**.\n**Reason:** ${reason}`,
            color: 'red',
        });

        await interaction.guild.bans.create(user.id, {
            reason,
            deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        });

        await logModerationAction(interaction, {
            caseType: duration ? 'tempban' : 'ban',
            title: 'User banned',
            color: 'red',
            user,
            reason,
            duration,
            extraFields: [
                { name: 'Duration', value: duration || 'Permanent', inline: true },
                { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
            ],
        });

        if (duration) {
            const durationInMs = parseDuration(duration);
            await upsertTempBan({
                guildId: interaction.guild.id,
                userId: user.id,
                reason,
                moderatorId: interaction.user.id,
                expiresAt: Date.now() + durationInMs,
                createdAt: Date.now(),
            });
        }

        await safeReply(interaction, {
            content: `User ${user.tag} has been banned. Reason: ${reason}${dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
        });
    },
};
