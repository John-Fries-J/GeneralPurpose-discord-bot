const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { fetchMember } = require('../../utils/discord');
const { sendLog, formatUser } = require('../../utils/logging');

function canManageRole(interaction, role) {
    const botMember = interaction.guild.members.me;
    return role.editable
        && role.position < botMember.roles.highest.position
        && (interaction.guild.ownerId === interaction.user.id || role.position < interaction.member.roles.highest.position);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Add or remove a role from a user.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a role to a user.')
                .addUserOption(option => option.setName('user').setDescription('The user to update.').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('The role to add.').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for adding the role.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a role from a user.')
                .addUserOption(option => option.setName('user').setDescription('The user to update.').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('The role to remove.').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for removing the role.'))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const reason = interaction.options.getString('reason') || `Role ${subcommand}`;
        const member = await fetchMember(interaction.guild, user.id);

        if (!member) {
            return interaction.reply({ content: language.moderation.userNotInServer, flags: 64 });
        }

        if (!canManageRole(interaction, role)) {
            return interaction.reply({ content: 'I cannot manage that role. Check role positions and permissions.', flags: 64 });
        }

        if (subcommand === 'add') {
            await member.roles.add(role, reason);
        } else {
            await member.roles.remove(role, reason);
        }

        await sendLog(interaction.guild, {
            type: 'moderation',
            title: `Role ${subcommand === 'add' ? 'added' : 'removed'}`,
            color: subcommand === 'add' ? 'green' : 'orange',
            user,
            fields: [
                { name: 'User', value: formatUser(user), inline: true },
                { name: 'Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Reason', value: reason },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `<@&${role.id}> was ${subcommand === 'add' ? 'added to' : 'removed from'} ${user.tag}.`, flags: 64 });
    },
};
