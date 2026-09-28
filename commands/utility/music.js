const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
    createAttachmentTrack,
    enqueue,
    generateDependencyReport,
    getMusicErrorMessage,
    getMusicSettings,
    getQueueSummary,
    getYtDlpCookieStatus,
    resolvePlayableTrack,
    skip,
    stop,
} = require('../../utils/music');
const { createQueuePayload, createStatusPayload, createTrackPayload } = require('../../utils/musicMessages');

function isRecognizedAudioAttachment(attachment) {
    return attachment.contentType?.startsWith('audio/')
        || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(attachment.name || '');
}

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
        .addSubcommand(subcommand => subcommand.setName('queue').setDescription('Show the current music queue.'))
        .addSubcommand(subcommand => subcommand.setName('skip').setDescription('Skip the current track.'))
        .addSubcommand(subcommand => subcommand.setName('stop').setDescription('Stop playback and leave voice.'))
        .addSubcommand(subcommand => subcommand.setName('debug').setDescription('Show music voice diagnostics.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'play') {
            await interaction.deferReply();
            try {
                const track = await resolvePlayableTrack(interaction.options.getString('query', true), interaction.user.id);
                const queue = await enqueue(interaction, track);
                return interaction.editReply(createTrackPayload(track, queue, {
                    title: queue.current === track ? 'Now Playing' : 'Added to Queue',
                }));
            } catch (error) {
                return interaction.editReply(createStatusPayload('Music Error', getMusicErrorMessage(error), { color: 'red', disabled: true }));
            }
        }

        if (subcommand === 'file') {
            await interaction.deferReply();
            try {
                if (!getMusicSettings().allowFileUploads) {
                    return interaction.editReply(createStatusPayload('Uploads Disabled', 'Music file uploads are disabled in config.', { color: 'orange', disabled: true }));
                }

                const attachment = interaction.options.getAttachment('audio', true);
                if (!isRecognizedAudioAttachment(attachment)) {
                    return interaction.editReply(createStatusPayload('Unsupported File', 'Upload a recognizable audio file.', { color: 'orange', disabled: true }));
                }

                const track = createAttachmentTrack(attachment, interaction.user.id);
                const queue = await enqueue(interaction, track);
                return interaction.editReply(createTrackPayload(track, queue, {
                    title: queue.current === track ? 'Now Playing' : 'Added to Queue',
                }));
            } catch (error) {
                return interaction.editReply(createStatusPayload('Music Error', getMusicErrorMessage(error), { color: 'red', disabled: true }));
            }
        }

        if (subcommand === 'queue') {
            return interaction.reply({
                ...createQueuePayload(getQueueSummary(interaction.guild.id)),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'skip') {
            const skipped = skip(interaction.guild.id);
            return interaction.reply({
                ...createStatusPayload(
                    skipped ? 'Skipped' : 'Nothing Playing',
                    skipped ? 'Skipped the current track.' : 'There is no active music queue.',
                    { color: skipped ? 'blue' : 'orange' },
                ),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'stop') {
            const stopped = stop(interaction.guild.id);
            return interaction.reply({
                ...createStatusPayload(
                    stopped ? 'Stopped' : 'Nothing Playing',
                    stopped ? 'Stopped playback and left voice.' : 'There is no active music queue.',
                    { color: stopped ? 'blue' : 'orange', disabled: true },
                ),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'debug') {
            const queue = getQueueSummary(interaction.guild.id);
            const cookies = getYtDlpCookieStatus();
            const report = generateDependencyReport()
                .split('\n')
                .filter(line => /@discordjs\/voice|discord\.js|libsodium|ffmpeg|node|dave/i.test(line))
                .join('\n')
                .slice(0, 1500);
            return interaction.reply({
                content: [
                    `Voice: ${queue.connectionState || 'not connected'}`,
                    `Current: ${queue.current?.title || 'none'}`,
                    `Queued: ${queue.tracks.length}`,
                    `Volume: ${queue.volume ?? 100}%`,
                    `YouTube cookies: ${cookies.exists ? `found (${cookies.size} bytes)` : 'not found'}`,
                    `Cookie path: ${cookies.resolvedPath || cookies.configuredPath || 'not configured'}`,
                    '```',
                    report,
                    '```',
                ].join('\n'),
                flags: MessageFlags.Ephemeral,
            });
        }

        return null;
    },
};
