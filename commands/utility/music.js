const { SlashCommandBuilder } = require('discord.js');
const {
    createAttachmentTrack,
    enqueue,
    generateDependencyReport,
    getMusicErrorMessage,
    getMusicSettings,
    getQueueSummary,
    resolvePlayableTrack,
    skip,
    stop,
} = require('../../utils/music');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Play music in your voice channel.')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Play a URL or search query. Spotify track links are resolved to a streamable source.')
                .addStringOption(option => option.setName('query').setDescription('Spotify/SoundCloud/YouTube URL or search text.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('file')
                .setDescription('Play an uploaded audio file.')
                .addAttachmentOption(option => option.setName('audio').setDescription('Audio file to play.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('queue')
                .setDescription('Show the current music queue.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('skip')
                .setDescription('Skip the current track.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop playback and leave voice.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('debug')
                .setDescription('Show music voice diagnostics.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'play') {
            await interaction.deferReply({ flags: 64 });
            try {
                const track = await resolvePlayableTrack(interaction.options.getString('query', true), interaction.user.id);
                const queue = await enqueue(interaction, track);
                const connecting = queue.connection?.state.status !== 'ready';
                const position = queue.current === track
                    ? (connecting ? `queued; voice is still connecting (${queue.connection.state.status})` : 'now playing')
                    : `queued at position ${queue.tracks.length}`;
                return interaction.editReply(`Added **${track.title}** (${track.source}); ${position}.`);
            } catch (error) {
                return interaction.editReply(getMusicErrorMessage(error));
            }
        }

        if (subcommand === 'file') {
            await interaction.deferReply({ flags: 64 });
            try {
                if (!getMusicSettings().allowFileUploads) {
                    return interaction.editReply('Music file uploads are disabled in config.');
                }

                const attachment = interaction.options.getAttachment('audio', true);
                if (!attachment.contentType?.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(attachment.name || '')) {
                    return interaction.editReply('Upload a recognizable audio file.');
                }

                const track = createAttachmentTrack(attachment, interaction.user.id);
                const queue = await enqueue(interaction, track);
                const connecting = queue.connection?.state.status !== 'ready';
                const position = queue.current === track
                    ? (connecting ? `queued; voice is still connecting (${queue.connection.state.status})` : 'now playing')
                    : `queued at position ${queue.tracks.length}`;
                return interaction.editReply(`Added **${track.title}**; ${position}.`);
            } catch (error) {
                return interaction.editReply(getMusicErrorMessage(error));
            }
        }

        if (subcommand === 'queue') {
            const queue = getQueueSummary(interaction.guild.id);
            const lines = [
                queue.current ? `Now: **${queue.current.title}**` : 'Nothing is currently playing.',
                queue.connectionState ? `Voice: ${queue.connectionState}` : null,
                ...queue.tracks.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`),
            ].filter(Boolean);
            return interaction.reply({ content: lines.join('\n'), flags: 64 });
        }

        if (subcommand === 'skip') {
            return interaction.reply({ content: skip(interaction.guild.id) ? 'Skipped.' : 'Nothing is playing.', flags: 64 });
        }

        if (subcommand === 'stop') {
            return interaction.reply({ content: stop(interaction.guild.id) ? 'Stopped playback and left voice.' : 'Nothing is playing.', flags: 64 });
        }

        if (subcommand === 'debug') {
            const queue = getQueueSummary(interaction.guild.id);
            const report = generateDependencyReport()
                .split('\n')
                .filter(line => /@discordjs\/voice|discord\.js|libsodium|ffmpeg|node/i.test(line))
                .join('\n')
                .slice(0, 1500);
            return interaction.reply({
                content: [
                    `Voice: ${queue.connectionState || 'not connected'}`,
                    `Current: ${queue.current?.title || 'none'}`,
                    `Queued: ${queue.tracks.length}`,
                    '```',
                    report,
                    '```',
                ].join('\n'),
                flags: 64,
            });
        }
    },
};
