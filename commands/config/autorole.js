const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { updateConfig } = require('../../utils/config');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Configure the role given to new members.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the autorole.')
                .addRoleOption(option => option.setName('role').setDescription('The role to give new members.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear autoroles.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set') {
            const role = interaction.options.getRole('role', true);
            if (!role.editable) {
                return interaction.reply({ content: 'I cannot assign that role. Check my role position and permissions.', flags: 64 });
            }

            updateConfig(config => {
                config.roles ||= {};
                config.roles.autoRoleId = role.id;
                config.roles.autoRoleIds = [];
                return config;
            });

            await sendLog(interaction.guild, {
                type: 'moderation',
                title: 'Autorole set',
                color: 'green',
                user: interaction.user,
                fields: [
                    { name: 'Role', value: `<@&${role.id}>`, inline: true },
                    { name: 'Updated by', value: formatUser(interaction.user), inline: true },
                ],
            }).catch(() => null);

            return interaction.reply({ content: `New members will now receive <@&${role.id}>.`, flags: 64 });
        }

        updateConfig(config => {
            config.roles ||= {};
            config.roles.autoRoleId = '';
            config.roles.autoRoleIds = [];
            return config;
        });

        await sendLog(interaction.guild, {
            type: 'moderation',
            title: 'Autorole cleared',
            color: 'orange',
            user: interaction.user,
            fields: [{ name: 'Updated by', value: formatUser(interaction.user), inline: true }],
        }).catch(() => null);

        return interaction.reply({ content: 'Autoroles have been cleared.', flags: 64 });
    },
};
