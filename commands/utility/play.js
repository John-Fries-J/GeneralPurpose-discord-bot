const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const {
    createAttachmentTrack,
    enqueue,
    getMusicErrorMessage,
    getMusicSettings,
    resolvePlayableTrack,
} = require('../../utils/music');
const { createStatusPayload, createTrackPayload } = require('../../utils/musicMessages');

function isRecognizedAudioAttachment(attachment) {
    return attachment.contentType?.startsWith('audio/')
        || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(attachment.name || '');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a URL, search query, or uploaded audio file.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Spotify/SoundCloud/YouTube URL or search text.'))
        .addAttachmentOption(option =>
            option
                .setName('audio')
                .setDescription('Audio file to play.')),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const query = interaction.options.getString('query');
            const attachment = interaction.options.getAttachment('audio');

            if (!query && !attachment) {
                return interaction.editReply(createStatusPayload(
                    'Nothing to Play',
                    'Provide a search query, URL, or audio attachment.',
                    { color: 'orange', disabled: true },
                ));
            }

            if (attachment && !getMusicSettings().allowFileUploads) {
                return interaction.editReply(createStatusPayload(
                    'Uploads Disabled',
                    'Music file uploads are disabled in config.',
                    { color: 'orange', disabled: true },
                ));
            }

            if (attachment && !isRecognizedAudioAttachment(attachment)) {
                return interaction.editReply(createStatusPayload(
                    'Unsupported File',
                    'Upload a recognizable audio file.',
                    { color: 'orange', disabled: true },
                ));
            }

            const track = attachment
                ? createAttachmentTrack(attachment, interaction.user.id)
                : await resolvePlayableTrack(query, interaction.user.id);
            const queue = await enqueue(interaction, track);
            return interaction.editReply(createTrackPayload(track, queue, {
                title: queue.current === track ? 'Now Playing' : 'Added to Queue',
            }));
        } catch (error) {
            return interaction.editReply(createStatusPayload(
                'Music Error',
                getMusicErrorMessage(error),
                { color: 'red', disabled: true },
            ));
        }
    },
};
