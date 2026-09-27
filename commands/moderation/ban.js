const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { parseDuration } = require('../../utils/duration');
const { createEmbed } = require('../../utils/embeds');
const { fetchMember, safeDm } = require('../../utils/discord');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to ban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban.'))
        .addStringOption(option => option.setName('duration').setDescription('Optional duration, such as 1d or 2h.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || language.general.noReason;
        const duration = interaction.options.getString('duration');
        const member = await fetchMember(interaction.guild, user.id);

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: language.moderation.cannotModerateSelf, ephemeral: true });
        }

        if (!member?.bannable) {
            return interaction.reply({ content: language.moderation.cannotBan, ephemeral: true });
        }

        if (duration && !parseDuration(duration)) {
            return interaction.reply({ content: language.moderation.invalidDuration, ephemeral: true });
        }

        const dmEmbed = createEmbed({
            title: 'User Banned',
            description: `You have been banned from **${interaction.guild.name}**.\n**Reason:** ${reason}`,
            color: 'red',
        });
        const dmSent = await safeDm(user, { embeds: [dmEmbed] });

        await member.ban({ reason });

        const reply = `User ${user.tag} has been banned. Reason: ${reason}${dmSent ? '' : `\n${language.moderation.dmFailed}`}`;
        await interaction.reply({ content: reply, ephemeral: true });

        if (duration) {
            const durationInMs = parseDuration(duration);
            setTimeout(async () => {
                try {
                    await interaction.guild.members.unban(user.id, 'Automatic unban after specified duration');
                } catch (error) {
                    console.error(`Automatic unban failed for ${user.id}:`, error);
                }
            }, durationInMs);
        }
    },
};
