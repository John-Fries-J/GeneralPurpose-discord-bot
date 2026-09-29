const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { fetchMember } = require('../../utils/discord');
const { logModerationAction, validateTarget } = require('../../utils/moderation');
const { softbanUser } = require('../../utils/softban');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Bans a user to delete messages, then unbans them with an invite link.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to softban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the softban.'))
        .addIntegerOption(option => option.setName('delete_days').setDescription('Delete message history from the past 0-7 days.').setMinValue(0).setMaxValue(7)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const deleteDays = interaction.options.getInteger('delete_days') ?? 7;
        const member = await fetchMember(interaction.guild, user.id);

        if (member) {
            const target = await validateTarget(interaction, user, 'bannable');
            if (!target.ok) {
                return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotBan : target.message, flags: 64 });
            }
        }

        let result;
        try {
            result = await softbanUser(interaction.guild, user.id, {
                reason,
                deleteMessageSeconds: deleteDays * 24 * 60 * 60,
            });
        } catch (error) {
            return interaction.reply({ content: error.message || 'Softban failed.', flags: 64 });
        }

        await logModerationAction(interaction, {
            caseType: 'softban',
            title: 'User softbanned',
            color: 'orange',
            user,
            reason,
            extraFields: [
                { name: 'Deleted days', value: `${deleteDays}`, inline: true },
                { name: 'Invite DM sent', value: result.dmSent ? 'Yes' : 'No', inline: true },
            ],
        });

        await interaction.reply({
            content: `${user.tag} has been softbanned.${result.dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
            flags: 64,
        });
    },
};
