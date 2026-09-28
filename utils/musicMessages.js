const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createEmbed } = require('./embeds');
const { truncate } = require('./discord');

const musicButtonIds = {
    queue: 'music:queue',
    skip: 'music:skip',
    stop: 'music:stop',
};

function isHttpUrl(value) {
    return /^https?:\/\//i.test(value || '');
}

function trackLabel(track) {
    const title = truncate(track?.title || 'Unknown track', 200);
    return isHttpUrl(track?.url) ? `[${title}](${track.url})` : title;
}

function createMusicButtons({ disabled = false } = {}) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(musicButtonIds.queue)
                .setLabel('Queue')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(musicButtonIds.skip)
                .setLabel('Skip')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(musicButtonIds.stop)
                .setLabel('Stop')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled),
        ),
    ];
}

function getTrackPosition(queue, track) {
    if (!queue || !track) return null;
    if (queue.current === track) return 'Now playing';

    const index = queue.tracks.indexOf(track);
    return index >= 0 ? `Queued at position ${index + 1}` : null;
}

function createTrackEmbed(track, queue, options = {}) {
    const position = options.position || getTrackPosition(queue, track);
    const fields = [
        position ? { name: 'Status', value: position, inline: true } : null,
        track?.source ? { name: 'Source', value: truncate(track.source, 64), inline: true } : null,
        queue?.volume !== undefined ? { name: 'Volume', value: `${queue.volume}%`, inline: true } : null,
    ].filter(Boolean);

    return createEmbed({
        title: options.title || 'Music',
        description: track ? trackLabel(track) : 'No track selected.',
        thumbnail: isHttpUrl(track?.thumbnail) ? track.thumbnail : undefined,
        fields,
        color: options.color || 'blue',
        footerText: 'Music',
    });
}

function createQueueEmbed(summary) {
    const fields = [];

    if (summary.current) {
        fields.push({ name: 'Now playing', value: trackLabel(summary.current) });
    }

    if (summary.tracks.length) {
        fields.push({
            name: 'Up next',
            value: summary.tracks
                .slice(0, 10)
                .map((track, index) => `${index + 1}. ${trackLabel(track)}`)
                .join('\n'),
        });
    }

    fields.push(
        { name: 'Voice', value: summary.connectionState || 'Not connected', inline: true },
        { name: 'Volume', value: `${summary.volume ?? 100}%`, inline: true },
    );

    return createEmbed({
        title: 'Music Queue',
        description: summary.current || summary.tracks.length ? null : 'Nothing is currently queued.',
        fields,
        color: 'blue',
        footerText: 'Music',
    });
}

function createStatusEmbed(title, description, options = {}) {
    return createEmbed({
        title,
        description,
        color: options.color || 'blue',
        footerText: 'Music',
    });
}

function createTrackPayload(track, queue, options = {}) {
    return {
        embeds: [createTrackEmbed(track, queue, options)],
        components: createMusicButtons(options),
    };
}

function createQueuePayload(summary, options = {}) {
    return {
        embeds: [createQueueEmbed(summary)],
        components: createMusicButtons(options),
    };
}

function createStatusPayload(title, description, options = {}) {
    return {
        embeds: [createStatusEmbed(title, description, options)],
        components: createMusicButtons(options),
    };
}

module.exports = {
    createMusicButtons,
    createQueuePayload,
    createStatusPayload,
    createTrackPayload,
    musicButtonIds,
    trackLabel,
};
