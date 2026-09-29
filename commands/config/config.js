const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { getGuildSettings, updateLoggingSettings } = require('../../utils/guildConfig');
const { sendLog, formatUser } = require('../../utils/logging');

const logChannelChoices = [
    ['general', 'logChannel'],
    ['moderation', 'moderation'],
    ['ticket', 'ticket'],
    ['suggestion', 'suggestion'],
    ['direct_message', 'directMessage'],
    ['message_delete', 'messageDelete'],
    ['message_update', 'editMessage'],
    ['thread_create', 'threadCreate'],
    ['thread_delete', 'threadDelete'],
    ['thread_update', 'threadUpdate'],
];

function maskSecret(value) {
    if (!value) return 'Not set';
    return value.length <= 8 ? '[set]' : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('View and update bot config.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the current config summary.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-log-channel')
                .setDescription('Set a log channel.')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('The log type to configure.')
                        .setRequired(true)
                        .addChoices(...logChannelChoices.map(([name]) => ({ name, value: name }))))
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The channel to use for this log type.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const config = getConfig();
            const guildConfig = await getGuildSettings(interaction.guild.id);
            const embed = createEmbed({
                title: 'Config Summary',
                color: 'blue',
                fields: [
                    { name: 'Token', value: maskSecret(config.token), inline: true },
                    { name: 'Client ID', value: config.clientId || 'Not set', inline: true },
                    { name: 'Guild ID', value: config.guildId || 'Not set', inline: true },
                    { name: 'Status', value: config.statusName || 'Not set', inline: true },
                    { name: 'Welcome Channel', value: guildConfig.welcomeID ? `<#${guildConfig.welcomeID}>` : 'Not set', inline: true },
                    { name: 'Suggestion Channel', value: config.suggestionID ? `<#${config.suggestionID}>` : 'Not set', inline: true },
                    { name: 'Auto Roles', value: [config.roles?.autoRoleId, ...(config.roles?.autoRoleIds || [])].filter(Boolean).map(roleId => `<@&${roleId}>`).join('\n') || 'Not set' },
                    { name: 'Log Channels', value: Object.entries(guildConfig.logChannels || {}).map(([key, value]) => `${key}: ${value ? `<#${value}>` : 'Not set'}`).join('\n') || 'Not set' },
                ],
            });

            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        if (subcommand === 'set-log-channel') {
            const type = interaction.options.getString('type', true);
            const channel = interaction.options.getChannel('channel', true);
            const configKey = logChannelChoices.find(([name]) => name === type)?.[1];

            await updateLoggingSettings(interaction.guild.id, {
                channels: { [configKey]: channel.id },
            }, {
                actorId: interaction.user.id,
                source: 'command',
            });

            await sendLog(interaction.guild, {
                type: 'general',
                title: 'Log channel updated',
                color: 'green',
                user: interaction.user,
                fields: [
                    { name: 'Type', value: type, inline: true },
                    { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                    { name: 'Updated by', value: formatUser(interaction.user), inline: true },
                ],
            }).catch(() => null);

            return interaction.reply({ content: `${type} logs will now go to <#${channel.id}>.`, flags: 64 });
        }
    },
};
