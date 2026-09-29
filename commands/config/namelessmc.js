const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const {
    getInfo,
    getNamelessConfig,
    getUserByDiscordId,
    submitRoleList,
    syncGuild,
    syncMember,
    updateBotSettings,
    updateDiscordUsernames,
    verifyDiscordLink,
} = require('../../utils/namelessmc');

function requireEnabled(interaction) {
    if (getNamelessConfig().enabled) return null;
    return interaction.reply({ content: 'NamelessMC integration is disabled. Use `/namelessmc enable` after configuring API settings.', flags: 64 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('namelessmc')
        .setDescription('Configure and use the NamelessMC website integration.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addSubcommand(subcommand =>
            subcommand
                .setName('link')
                .setDescription('Link your Discord account to NamelessMC with a website verification code.')
                .addStringOption(option => option.setName('code').setDescription('NamelessMC integration verification code.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check NamelessMC integration status.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('lookup')
                .setDescription('Look up a linked NamelessMC user for a Discord member.')
                .addUserOption(option => option.setName('user').setDescription('Discord user to look up.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('configure')
                .setDescription('Set NamelessMC API URL and API key.')
                .addStringOption(option => option.setName('api_url').setDescription('Full v2 API URL, for example https://site.com/api/v2').setRequired(true))
                .addStringOption(option => option.setName('api_key').setDescription('API key from StaffCP.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable the NamelessMC integration.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable the NamelessMC integration.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Submit this bot and the current role list to NamelessMC.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('submit-roles')
                .setDescription('Submit the current Discord role list to NamelessMC.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('update-usernames')
                .setDescription('Submit current Discord usernames to NamelessMC.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync-user')
                .setDescription('Sync one linked member according to the configured role sync direction.')
                .addUserOption(option => option.setName('user').setDescription('Member to sync.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync-all')
                .setDescription('Sync all linked members according to the configured role sync direction.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('map-role')
                .setDescription('Map a NamelessMC group to a Discord role.')
                .addRoleOption(option => option.setName('role').setDescription('Discord role to manage.').setRequired(true))
                .addStringOption(option => option.setName('group_id').setDescription('NamelessMC group ID.'))
                .addStringOption(option => option.setName('group_name').setDescription('NamelessMC group name.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unmap-role')
                .setDescription('Remove a Discord role from NamelessMC group sync mappings.')
                .addRoleOption(option => option.setName('role').setDescription('Discord role to remove from mappings.').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'link') {
            const disabledReply = requireEnabled(interaction);
            if (disabledReply) return disabledReply;

            const settings = getNamelessConfig();
            if (!settings.link.enabled) {
                return interaction.reply({ content: 'NamelessMC Discord linking is disabled in config.', flags: 64 });
            }

            await interaction.deferReply({ flags: 64 });
            await verifyDiscordLink(interaction.user, interaction.options.getString('code', true), settings);
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (member) await syncMember(member, settings).catch(() => null);
            return interaction.editReply('Your Discord account has been linked with NamelessMC.');
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'You need Manage Server to manage NamelessMC integration commands.', flags: 64 });
        }

        if (subcommand === 'configure') {
            const apiUrl = interaction.options.getString('api_url', true).replace(/\/+$/, '');
            const apiKey = interaction.options.getString('api_key', true);
            updateConfig(config => {
                config.namelessmc ||= {};
                config.namelessmc.apiUrl = apiUrl;
                config.namelessmc.apiKey = apiKey;
                config.namelessmc.enabled = false;
                return config;
            });
            return interaction.reply({ content: 'NamelessMC API settings saved. The integration remains disabled until `/namelessmc enable` is used.', flags: 64 });
        }

        if (subcommand === 'enable' || subcommand === 'disable') {
            const enabled = subcommand === 'enable';
            updateConfig(config => {
                config.namelessmc ||= {};
                config.namelessmc.enabled = enabled;
                return config;
            });
            return interaction.reply({ content: `NamelessMC integration ${enabled ? 'enabled' : 'disabled'}.`, flags: 64 });
        }

        const disabledReply = requireEnabled(interaction);
        if (disabledReply) return disabledReply;

        const settings = getNamelessConfig();

        if (subcommand === 'status') {
            await interaction.deferReply({ flags: 64 });
            const info = await getInfo(settings);
            const embed = createEmbed({
                title: 'NamelessMC Status',
                color: 'blue',
                fields: [
                    { name: 'Enabled', value: settings.enabled ? 'Yes' : 'No', inline: true },
                    { name: 'API URL', value: settings.apiUrl, inline: false },
                    { name: 'Version', value: info.nameless_version || 'Unknown', inline: true },
                    { name: 'Role sync', value: settings.roleSync.enabled ? `${settings.roleSync.direction}` : 'Disabled', inline: true },
                    { name: 'Mappings', value: `${settings.roleSync.groupRoleMap.length}`, inline: true },
                ],
            });
            return interaction.editReply({ embeds: [embed] });
        }

        if (subcommand === 'setup') {
            await interaction.deferReply({ flags: 64 });
            await updateBotSettings(interaction.client, interaction.guild, settings);
            const roleCount = await submitRoleList(interaction.guild, settings);
            return interaction.editReply(`NamelessMC bot settings updated and ${roleCount} Discord roles submitted.`);
        }

        if (subcommand === 'submit-roles') {
            await interaction.deferReply({ flags: 64 });
            const roleCount = await submitRoleList(interaction.guild, settings);
            return interaction.editReply(`Submitted ${roleCount} Discord roles to NamelessMC.`);
        }

        if (subcommand === 'update-usernames') {
            await interaction.deferReply({ flags: 64 });
            const userCount = await updateDiscordUsernames(interaction.guild, settings);
            return interaction.editReply(`Submitted ${userCount} Discord usernames to NamelessMC.`);
        }

        if (subcommand === 'lookup') {
            await interaction.deferReply({ flags: 64 });
            const user = interaction.options.getUser('user', true);
            const namelessUser = await getUserByDiscordId(user.id, settings);
            if (!namelessUser) return interaction.editReply('No linked NamelessMC user was found for that Discord user.');
            return interaction.editReply(`Linked NamelessMC user: ${namelessUser.username || namelessUser.id} (ID ${namelessUser.id}).`);
        }

        if (subcommand === 'sync-user') {
            await interaction.deferReply({ flags: 64 });
            const user = interaction.options.getUser('user', true);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) return interaction.editReply('That user is not in this server.');
            const result = await syncMember(member, settings);
            return interaction.editReply(`Sync complete for ${user.tag}. ${JSON.stringify(result)}`);
        }

        if (subcommand === 'sync-all') {
            await interaction.deferReply({ flags: 64 });
            const result = await syncGuild(interaction.guild, settings);
            return interaction.editReply(`NamelessMC sync complete. Synced ${result.synced || 0}, failed ${result.failed || 0}.`);
        }

        if (subcommand === 'map-role') {
            const role = interaction.options.getRole('role', true);
            const groupId = interaction.options.getString('group_id');
            const groupName = interaction.options.getString('group_name');
            if (!groupId && !groupName) {
                return interaction.reply({ content: 'Provide either group_id or group_name.', flags: 64 });
            }

            updateConfig(config => {
                config.namelessmc ||= {};
                config.namelessmc.roleSync ||= {};
                config.namelessmc.roleSync.groupRoleMap = (config.namelessmc.roleSync.groupRoleMap || []).filter(item => item.roleId !== role.id);
                config.namelessmc.roleSync.groupRoleMap.push({ roleId: role.id, groupId: groupId || '', groupName: groupName || '' });
                return config;
            });
            return interaction.reply({ content: `Mapped NamelessMC group ${groupId || groupName} to <@&${role.id}>.`, flags: 64 });
        }

        if (subcommand === 'unmap-role') {
            const role = interaction.options.getRole('role', true);
            updateConfig(config => {
                config.namelessmc ||= {};
                config.namelessmc.roleSync ||= {};
                config.namelessmc.roleSync.groupRoleMap = (config.namelessmc.roleSync.groupRoleMap || []).filter(item => item.roleId !== role.id);
                return config;
            });
            return interaction.reply({ content: `<@&${role.id}> removed from NamelessMC group sync mappings.`, flags: 64 });
        }
    },
};
