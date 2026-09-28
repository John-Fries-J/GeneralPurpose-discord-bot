const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { fetchMember } = require('../../utils/discord');
const { sendLog, formatUser } = require('../../utils/logging');
const { upsertTempRole } = require('../../utils/store');

function canManageRole(interaction, role) {
    const botMember = interaction.guild.members.me;
    return role.editable
        && role.position < botMember.roles.highest.position
        && (interaction.guild.ownerId === interaction.user.id || role.position < interaction.member.roles.highest.position);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('temprole')
        .setDescription('Give a user a role for a limited time.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(option => option.setName('user').setDescription('The user to update.').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to add temporarily.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration, such as 10m, 2h, 3d, or 1w.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for adding the temporary role.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const duration = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') || 'Temporary role';
        const durationMs = parseDuration(duration);
        const member = await fetchMember(interaction.guild, user.id);

        if (!member) return interaction.reply({ content: 'That user is not in this server.', flags: 64 });
        if (!durationMs) return interaction.reply({ content: 'Use a duration such as 10m, 2h, 3d, or 1w.', flags: 64 });
        if (!canManageRole(interaction, role)) {
            return interaction.reply({ content: 'I cannot manage that role. Check role positions and permissions.', flags: 64 });
        }

        await member.roles.add(role, reason);
        await upsertTempRole({
            guildId: interaction.guild.id,
            userId: user.id,
            userTag: user.tag,
            roleId: role.id,
            roleName: role.name,
            moderatorId: interaction.user.id,
            reason,
            createdAt: Date.now(),
            expiresAt: Date.now() + durationMs,
        });

        await sendLog(interaction.guild, {
            type: 'moderation',
            title: 'Temporary role added',
            color: 'blue',
            user,
            fields: [
                { name: 'User', value: formatUser(user), inline: true },
                { name: 'Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Duration', value: duration, inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Reason', value: reason },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `<@&${role.id}> was added to ${user.tag} for ${duration}.`, flags: 64 });
    },
};
