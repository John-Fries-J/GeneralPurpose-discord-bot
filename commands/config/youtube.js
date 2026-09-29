const { InteractionContextType, ApplicationIntegrationType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('youtube')
        .setDescription('Configure YouTube announcements.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-api-key')
                .setDescription('Set the YouTube Data API key for better type detection.')
                .addStringOption(option => option.setName('api_key').setDescription('YouTube Data API key.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a YouTube announcement channel.')
                .addStringOption(option => option.setName('channel_id').setDescription('YouTube channel ID.').setRequired(true))
                .addChannelOption(option => option.setName('text_channel').setDescription('Discord announcement channel.').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addStringOption(option => option.setName('name').setDescription('Display name for templates.'))
                .addStringOption(option => option.setName('video_message').setDescription('Template for videos. {title} {url} {channel} {type}'))
                .addStringOption(option => option.setName('short_message').setDescription('Template for shorts.'))
                .addStringOption(option => option.setName('stream_message').setDescription('Template for streams.'))
                .addStringOption(option => option.setName('community_message').setDescription('Best-effort only; YouTube RSS does not include community posts.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a YouTube announcement channel.')
                .addStringOption(option => option.setName('channel_id').setDescription('YouTube channel ID.').setRequired(true))
                .addChannelOption(option => option.setName('text_channel').setDescription('Discord announcement channel.').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List YouTube announcement channels.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set-api-key') {
            const apiKey = interaction.options.getString('api_key', true);
            updateConfig(config => {
                config.youtube ||= {};
                config.youtube.apiKey = apiKey;
                config.youtube.channels ||= [];
                return config;
            });
            return interaction.reply({ content: 'YouTube API key saved.', flags: 64 });
        }

        if (subcommand === 'add') {
            const channelId = interaction.options.getString('channel_id', true);
            const textChannel = interaction.options.getChannel('text_channel', true);
            const name = interaction.options.getString('name') || channelId;
            const messages = {
                video: interaction.options.getString('video_message') || '{title}\n{url}',
                short: interaction.options.getString('short_message') || '{title}\n{url}',
                stream: interaction.options.getString('stream_message') || '{title}\n{url}',
                community: interaction.options.getString('community_message') || '{title}\n{url}',
            };

            updateConfig(config => {
                config.youtube ||= {};
                config.youtube.channels = (config.youtube.channels || []).filter(item => !(item.channelId === channelId && item.discordChannelId === textChannel.id));
                config.youtube.channels.push({
                    enabled: true,
                    channelId,
                    name,
                    discordChannelId: textChannel.id,
                    messages,
                    lastItemId: '',
                });
                return config;
            });

            return interaction.reply({ content: `YouTube announcements for ${name} will go to <#${textChannel.id}>.`, flags: 64 });
        }

        if (subcommand === 'remove') {
            const channelId = interaction.options.getString('channel_id', true);
            const textChannel = interaction.options.getChannel('text_channel');
            updateConfig(config => {
                config.youtube ||= {};
                config.youtube.channels = (config.youtube.channels || []).filter(item => {
                    if (item.channelId !== channelId) return true;
                    return textChannel ? item.discordChannelId !== textChannel.id : false;
                });
                return config;
            });
            return interaction.reply({ content: 'YouTube announcement target removed.', flags: 64 });
        }

        const channels = getConfig().youtube?.channels || [];
        const embed = createEmbed({
            title: 'YouTube Announcements',
            color: 'red',
            description: channels.length
                ? channels.map(item => `${item.name || item.channelId} -> <#${item.discordChannelId}>`).join('\n')
                : 'No YouTube announcement channels configured.',
        });
        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
