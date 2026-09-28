const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { sendHoneypotNotice } = require('../../utils/honeypot');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('honeypot')
        .setDescription('Configure the scam honeypot channel.')
        .setDMPermission(false)
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
                        .setDescription('Optional user or role to ping when the honeypot triggers.')))
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
            const pingType = ping?.user || ping?.username ? 'user' : ping?.id ? 'role' : '';
            const pingMention = ping?.id ? (pingType === 'role' ? `<@&${ping.id}>` : `<@${ping.id}>`) : '';

            updateConfig(config => {
                config.honeypot = {
                    enabled: true,
                    channelId: channel.id,
                    alertChannelId: alertChannel.id,
                    mentionId: ping?.id || '',
                    mentionType: pingType,
                };
                return config;
            });

            await sendHoneypotNotice(channel).catch(error => {
                console.error('Failed to send honeypot notice:', error);
            });

            return interaction.reply({
                content: `Honeypot enabled in <#${channel.id}>. Scam alerts will go to <#${alertChannel.id}>${pingMention ? ` and ping ${pingMention}` : ''}.`,
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

        const settings = getConfig().honeypot || {};
        const embed = createEmbed({
            title: 'Honeypot Settings',
            color: settings.enabled ? 'green' : 'orange',
            fields: [
                { name: 'Enabled', value: settings.enabled ? 'Yes' : 'No', inline: true },
                { name: 'Channel', value: settings.channelId ? `<#${settings.channelId}>` : 'Not set', inline: true },
                { name: 'Alert Channel', value: settings.alertChannelId ? `<#${settings.alertChannelId}>` : 'Not set', inline: true },
                { name: 'Ping', value: settings.mentionId ? `${settings.mentionType === 'role' ? `<@&${settings.mentionId}>` : `<@${settings.mentionId}>`}` : 'None', inline: true },
            ],
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
