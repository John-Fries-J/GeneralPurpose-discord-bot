const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const {
    DEFAULT_TIMEOUT_DURATION_MS,
    MAX_TIMEOUT_DURATION_MS,
    getHoneypotConfig,
    postOrRefreshLimitedAccountRecoveryPanel,
    sendHoneypotNotice,
    validateLimitedAccountSetup,
} = require('../../utils/honeypot');

function mentionType(mentionable) {
    if (!mentionable) return '';
    return mentionable.user || mentionable.tag || mentionable.username ? 'user' : 'role';
}

function mentionText(mentionable, type) {
    if (!mentionable?.id) return '';
    return type === 'role' ? `<@&${mentionable.id}>` : `<@${mentionable.id}>`;
}

function ensureHoneypotDefaults(honeypot = {}) {
    return {
        ...honeypot,
        actions: {
            limit: honeypot.actions?.limit !== false,
            softban: honeypot.actions?.softban !== false,
            timeout: honeypot.actions?.timeout !== false,
            ignore: honeypot.actions?.ignore !== false,
        },
        timeoutDurationMs: honeypot.timeoutDurationMs || DEFAULT_TIMEOUT_DURATION_MS,
        limitedAccount: {
            enabled: honeypot.limitedAccount?.enabled !== false,
            roleId: honeypot.limitedAccount?.roleId || '',
            channelId: honeypot.limitedAccount?.channelId || '',
            panelMessageId: honeypot.limitedAccount?.panelMessageId || '',
            restoreButton: honeypot.limitedAccount?.restoreButton !== false,
            removeExistingRoles: honeypot.limitedAccount?.removeExistingRoles !== false,
        },
    };
}

function formatBoolean(value) {
    return value ? 'Yes' : 'No';
}

function formatDuration(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} minute(s)`;
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours} hour(s)` : `${minutes} minute(s)`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('honeypot')
        .setDescription('Configure the scam honeypot channel.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('configure')
                .setDescription('Enable and configure the honeypot.')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The honeypot channel.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addChannelOption(option =>
                    option
                        .setName('alert_channel')
                        .setDescription('Where scam alerts should be sent.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addMentionableOption(option =>
                    option
                        .setName('ping')
                        .setDescription('Optional user or role to ping when the honeypot triggers.'))
                .addRoleOption(option =>
                    option
                        .setName('limited_role')
                        .setDescription('Role assigned to limited accounts.'))
                .addChannelOption(option =>
                    option
                        .setName('recovery_channel')
                        .setDescription('Channel where limited accounts can regain access.')
                        .addChannelTypes(ChannelType.GuildText))
                .addIntegerOption(option =>
                    option
                        .setName('timeout_minutes')
                        .setDescription('Honeypot timeout action duration in minutes.')
                        .setMinValue(1)
                        .setMaxValue(Math.floor(MAX_TIMEOUT_DURATION_MS / 60000))))
        .addSubcommand(subcommand =>
            subcommand
                .setName('recovery-panel')
                .setDescription('Post or refresh the limited-account recovery panel.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable honeypot detection.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View honeypot settings.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'configure') {
            const channel = interaction.options.getChannel('channel', true);
            const alertChannel = interaction.options.getChannel('alert_channel', true);
            const ping = interaction.options.getMentionable('ping');
            const limitedRole = interaction.options.getRole('limited_role');
            const recoveryChannel = interaction.options.getChannel('recovery_channel');
            const timeoutMinutes = interaction.options.getInteger('timeout_minutes');
            const pingKind = mentionType(ping);
            const pingMention = mentionText(ping, pingKind);

            updateConfig(config => {
                const existing = ensureHoneypotDefaults(config.honeypot || {});
                config.honeypot = {
                    ...existing,
                    enabled: true,
                    channelId: channel.id,
                    alertChannelId: alertChannel.id,
                    mentionId: ping?.id || existing.mentionId || '',
                    mentionType: ping ? pingKind : existing.mentionType || '',
                    timeoutDurationMs: timeoutMinutes ? timeoutMinutes * 60000 : existing.timeoutDurationMs,
                    limitedAccount: {
                        ...existing.limitedAccount,
                        roleId: limitedRole?.id || existing.limitedAccount.roleId,
                        channelId: recoveryChannel?.id || existing.limitedAccount.channelId,
                    },
                };
                return config;
            });

            await sendHoneypotNotice(channel).catch(error => {
                console.error('Failed to send honeypot notice:', error);
            });

            const parts = [
                `Honeypot enabled in <#${channel.id}>.`,
                `Scam alerts will go to <#${alertChannel.id}>.`,
            ];
            if (pingMention) parts.push(`Alerts will ping ${pingMention}.`);
            if (limitedRole) parts.push(`Limited role set to <@&${limitedRole.id}>.`);
            if (recoveryChannel) parts.push(`Recovery channel set to <#${recoveryChannel.id}>.`);
            if (timeoutMinutes) parts.push(`Timeout duration set to ${timeoutMinutes} minute(s).`);

            return interaction.reply({ content: parts.join(' '), flags: 64 });
        }

        if (subcommand === 'recovery-panel') {
            const settings = getHoneypotConfig();
            const result = await postOrRefreshLimitedAccountRecoveryPanel(interaction.guild, settings);
            if (!result.ok) return interaction.reply({ content: result.message, flags: 64 });

            const diagnostics = await validateLimitedAccountSetup(interaction.guild, getHoneypotConfig(), { requirePanel: true });
            const warning = diagnostics.diagnostics.length ? `\n\nDiagnostics:\n- ${diagnostics.diagnostics.join('\n- ')}` : '';
            return interaction.reply({
                content: `Recovery panel ${result.action} in <#${result.channelId}>.${warning}`,
                flags: 64,
            });
        }

        if (subcommand === 'disable') {
            updateConfig(config => {
                config.honeypot ||= {};
                config.honeypot.enabled = false;
                return config;
            });

            return interaction.reply({ content: 'Honeypot disabled.', flags: 64 });
        }

        const settings = getHoneypotConfig(getConfig());
        const diagnostics = await validateLimitedAccountSetup(interaction.guild, settings, { requirePanel: true });
        const embed = createEmbed({
            title: 'Honeypot Settings',
            color: settings.enabled ? 'green' : 'orange',
            fields: [
                { name: 'Enabled', value: formatBoolean(settings.enabled), inline: true },
                { name: 'Channel', value: settings.channelId ? `<#${settings.channelId}>` : 'Not set', inline: true },
                { name: 'Alert Channel', value: settings.alertChannelId ? `<#${settings.alertChannelId}>` : 'Not set', inline: true },
                { name: 'Ping', value: settings.mentionId ? `${settings.mentionType === 'role' ? `<@&${settings.mentionId}>` : `<@${settings.mentionId}>`}` : 'None', inline: true },
                { name: 'Actions', value: Object.entries(settings.actions).filter(([, enabled]) => enabled).map(([name]) => name).join(', ') || 'None' },
                { name: 'Timeout Duration', value: formatDuration(settings.timeoutDurationMs), inline: true },
                { name: 'Limited Role', value: settings.limitedAccount.roleId ? `<@&${settings.limitedAccount.roleId}>` : 'Not set', inline: true },
                { name: 'Recovery Channel', value: settings.limitedAccount.channelId ? `<#${settings.limitedAccount.channelId}>` : 'Not set', inline: true },
                { name: 'Recovery Panel', value: settings.limitedAccount.panelMessageId || 'Not posted', inline: true },
                { name: 'Setup Diagnostics', value: diagnostics.diagnostics.length ? diagnostics.diagnostics.map(item => `- ${item}`).join('\n').slice(0, 1000) : 'No obvious issues.' },
            ],
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
