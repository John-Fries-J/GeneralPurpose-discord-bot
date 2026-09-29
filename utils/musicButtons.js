const { MessageFlags } = require('discord.js');
const { adjustVolume, getQueueSummary, skip, stop, togglePause } = require('./music');
const { createQueuePayload, createStatusPayload, musicButtonIds } = require('./musicMessages');

function memberCanControlMusic(interaction, summary) {
    const voiceChannelId = summary.voiceChannelId;
    return !voiceChannelId || interaction.member?.voice?.channelId === voiceChannelId;
}

async function replyWrongVoiceChannel(interaction) {
    await interaction.reply({
        ...createStatusPayload('Join Playback Voice', 'Join the active playback voice channel before using music controls.', { color: 'orange' }),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleMusicButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('music:') || !interaction.guild) return false;
    const summary = getQueueSummary(interaction.guild.id);

    if (interaction.customId === musicButtonIds.queue) {
        await interaction.reply({
            ...createQueuePayload(summary),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (!memberCanControlMusic(interaction, summary)) {
        await replyWrongVoiceChannel(interaction);
        return true;
    }

    if (interaction.customId === musicButtonIds.pause) {
        const result = togglePause(interaction.guild.id);
        await interaction.reply({
            ...createStatusPayload(
                result?.ok ? (result.paused ? 'Paused' : 'Resumed') : 'Nothing Playing',
                result?.ok ? (result.paused ? 'Paused playback.' : 'Resumed playback.') : 'There is no active track to pause.',
                { color: result?.ok ? 'blue' : 'orange', paused: result?.paused },
            ),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.customId === musicButtonIds.skip) {
        const skipped = skip(interaction.guild.id);
        await interaction.reply({
            ...createStatusPayload(
                skipped ? 'Skipped' : 'Nothing Playing',
                skipped ? 'Skipped the current track.' : 'There is no active music queue.',
                { color: skipped ? 'blue' : 'orange' },
            ),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.customId === musicButtonIds.stop) {
        const stopped = stop(interaction.guild.id);
        await interaction.reply({
            ...createStatusPayload(
                stopped ? 'Stopped' : 'Nothing Playing',
                stopped ? 'Stopped playback and left voice.' : 'There is no active music queue.',
                { color: stopped ? 'blue' : 'orange', disabled: true },
            ),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.customId === musicButtonIds.volumeDown || interaction.customId === musicButtonIds.volumeUp) {
        const queue = adjustVolume(interaction.guild.id, interaction.customId === musicButtonIds.volumeUp ? 10 : -10);
        await interaction.reply({
            ...createStatusPayload(
                queue ? 'Volume Updated' : 'Nothing Playing',
                queue ? `Playback volume is now ${queue.volume}%.` : 'There is no active music queue.',
                { color: queue ? 'blue' : 'orange' },
            ),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    return false;
}

module.exports = {
    handleMusicButton,
};
