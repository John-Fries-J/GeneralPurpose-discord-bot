const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch')
        .setDescription('Configure Twitch live announcements.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-credentials')
                .setDescription('Set Twitch API credentials.')
                .addStringOption(option => option.setName('client_id').setDescription('Twitch Client ID.').setRequired(true))
                .addStringOption(option => option.setName('client_secret').setDescription('Twitch Client Secret for automatic token refresh.'))
                .addStringOption(option => option.setName('access_token').setDescription('Optional existing Twitch app access token.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a Twitch streamer announcement.')
                .addStringOption(option => option.setName('streamer_id').setDescription('Twitch user ID.').setRequired(true))
                .addStringOption(option => option.setName('streamer_name').setDescription('Twitch username.').setRequired(true))
                .addChannelOption(option => option.setName('text_channel').setDescription('Discord announcement channel.').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addStringOption(option => option.setName('message').setDescription('Template: {streamer} {title} {game} {url}')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a Twitch streamer announcement.')
                .addStringOption(option => option.setName('streamer_id').setDescription('Twitch user ID.').setRequired(true))
                .addChannelOption(option => option.setName('text_channel').setDescription('Discord announcement channel.').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List Twitch announcement channels.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set-credentials') {
            updateConfig(config => {
                config.twitch ||= {};
                config.twitch.clientId = interaction.options.getString('client_id', true);
                const clientSecret = interaction.options.getString('client_secret');
                const accessToken = interaction.options.getString('access_token');
                if (clientSecret !== null) config.twitch.clientSecret = clientSecret;
                if (accessToken !== null) {
                    config.twitch.accessToken = accessToken;
                    config.twitch.accessTokenExpiresAt = 0;
                }
                config.twitch.channels ||= [];
                return config;
            });
            return interaction.reply({ content: 'Twitch credentials saved.', flags: 64 });
        }

        if (subcommand === 'add') {
            const streamerId = interaction.options.getString('streamer_id', true);
            const streamerName = interaction.options.getString('streamer_name', true);
            const textChannel = interaction.options.getChannel('text_channel', true);
            const message = interaction.options.getString('message') || '{streamer} is live: {title}\n{url}';

            updateConfig(config => {
                config.twitch ||= {};
                config.twitch.channels = (config.twitch.channels || []).filter(item => !(item.streamerId === streamerId && item.discordChannelId === textChannel.id));
                config.twitch.channels.push({
                    enabled: true,
                    streamerId,
                    streamerName,
                    discordChannelId: textChannel.id,
                    message,
                    lastStreamId: '',
                });
                return config;
            });

            return interaction.reply({ content: `Twitch announcements for ${streamerName} will go to <#${textChannel.id}>.`, flags: 64 });
        }

        if (subcommand === 'remove') {
            const streamerId = interaction.options.getString('streamer_id', true);
            const textChannel = interaction.options.getChannel('text_channel');
            updateConfig(config => {
                config.twitch ||= {};
                config.twitch.channels = (config.twitch.channels || []).filter(item => {
                    if (item.streamerId !== streamerId) return true;
                    return textChannel ? item.discordChannelId !== textChannel.id : false;
                });
                return config;
            });
            return interaction.reply({ content: 'Twitch announcement target removed.', flags: 64 });
        }

        const channels = getConfig().twitch?.channels || [];
        const embed = createEmbed({
            title: 'Twitch Announcements',
            color: 'purple',
            description: channels.length
                ? channels.map(item => `${item.streamerName} -> <#${item.discordChannelId}>`).join('\n')
                : 'No Twitch announcement channels configured.',
        });
        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
