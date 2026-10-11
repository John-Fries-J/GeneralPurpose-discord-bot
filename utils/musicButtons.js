const { MessageFlags } = require('discord.js');
const { adjustVolume, getQueueSummary } = require('./music');
const {
    MusicControlError,
    memberCanControlMusic,
    pauseMusic,
    resumeMusic,
    skipMusic,
    stopMusic,
} = require('../services/musicControlService');
const { createQueuePayload, createStatusPayload, musicButtonIds } = require('./musicMessages');

async function replyWrongVoiceChannel(interaction) {
    await interaction.reply({
        ...createStatusPayload('Join Playback Voice', 'Join the active playback voice channel before using music controls.', { color: 'orange' }),
        flags: MessageFlags.Ephemeral,
    });
}

function musicErrorMessage(error) {
    if (error instanceof MusicControlError) return error.message;
    return error?.message || 'Music control failed.';
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

    if (!memberCanControlMusic(interaction.member, summary)) {
        await replyWrongVoiceChannel(interaction);
        return true;
    }

    if (interaction.customId === musicButtonIds.pause) {
        const result = summary.paused
            ? await resumeMusic(interaction.client, interaction.guild.id, interaction.user.id).then(() => ({ ok: true, paused: false })).catch(error => ({ ok: false, error }))
            : await pauseMusic(interaction.client, interaction.guild.id, interaction.user.id).then(() => ({ ok: true, paused: true })).catch(error => ({ ok: false, error }));
        await interaction.reply({
            ...createStatusPayload(
                result?.ok ? (result.paused ? 'Paused' : 'Resumed') : 'Nothing Playing',
                result?.ok ? (result.paused ? 'Paused playback.' : 'Resumed playback.') : musicErrorMessage(result.error),
                { color: result?.ok ? 'blue' : 'orange', paused: result?.paused },
            ),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.customId === musicButtonIds.skip) {
        const skipped = await skipMusic(interaction.client, interaction.guild.id, interaction.user.id).then(() => true).catch(() => false);
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
        const stopped = await stopMusic(interaction.client, interaction.guild.id, interaction.user.id).then(() => true).catch(() => false);
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
