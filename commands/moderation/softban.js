const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { fetchMember } = require('../../utils/discord');
const { logModerationAction, validateTarget } = require('../../utils/moderation');

async function createSoftbanInvite(guild, reason) {
    const botMember = guild.members.me;
    const channel = guild.channels.cache.find(candidate => {
        if (!candidate?.createInvite) return false;
        const permissions = candidate.permissionsFor(botMember);
        return permissions?.has(PermissionFlagsBits.CreateInstantInvite);
    });

    if (!channel) return null;

    return channel.createInvite({
        maxAge: 24 * 60 * 60,
        maxUses: 1,
        unique: true,
        reason,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Bans a user to delete messages, then unbans them with an invite link.')
        .setDMPermission(false)
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
                return interaction.reply({ content: target.message === language.moderation.cannotModerateUser ? language.moderation.cannotBan : target.message, ephemeral: true });
            }
        }

        const invite = await createSoftbanInvite(interaction.guild, `Softban invite for ${user.tag}: ${reason}`);
        if (!invite) {
            return interaction.reply({ content: 'I could not create an invite link for this softban.', ephemeral: true });
        }

        let dmSent = true;
        try {
            await user.send(`you have been softbanned heres a invite link: ${invite.url}`);
        } catch {
            dmSent = false;
        }

        await interaction.guild.bans.create(user.id, {
            reason,
            deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        });

        await interaction.guild.members.unban(user.id, 'Softban complete');

        await logModerationAction(interaction, {
            caseType: 'softban',
            title: 'User softbanned',
            color: 'orange',
            user,
            reason,
            extraFields: [
                { name: 'Deleted days', value: `${deleteDays}`, inline: true },
                { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
            ],
        });

        await interaction.reply({
            content: `${user.tag} has been softbanned.${dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
            ephemeral: true,
        });
    },
};
