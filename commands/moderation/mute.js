const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { parseDuration } = require('../../utils/duration');
const { createEmbed } = require('../../utils/embeds');
const { fetchMember, safeDm } = require('../../utils/discord');

const maxTimeoutDuration = 28 * 24 * 60 * 60 * 1000;

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
        const member = await fetchMember(interaction.guild, user.id);

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: language.moderation.cannotModerateSelf, ephemeral: true });
        }

        if (!durationInMs) {
            return interaction.reply({ content: language.moderation.invalidDuration, ephemeral: true });
        }

        if (durationInMs > maxTimeoutDuration) {
            return interaction.reply({ content: language.moderation.muteMaxDuration, ephemeral: true });
        }

        if (!member?.moderatable) {
            return interaction.reply({ content: 'I cannot mute this user.', ephemeral: true });
        }

        await member.timeout(durationInMs, reason);

        const embed = createEmbed({
            title: 'User Muted',
            description: `**${member.user.tag}** has been muted for ${duration}.\n**Reason:** ${reason}`,
            color: 'orange',
        });
        await interaction.reply({ embeds: [embed] });

        const dmEmbed = createEmbed({
            title: 'User Muted',
            description: `You have been muted in **${interaction.guild.name}** for ${duration}.\n**Reason:** ${reason}`,
            color: 'orange',
        });
        await safeDm(user, { embeds: [dmEmbed] });
    },
};
