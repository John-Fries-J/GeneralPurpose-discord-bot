const { MessageFlags } = require('discord.js');
const { getQueueSummary, skip, stop } = require('./music');
const { createQueuePayload, createStatusPayload, musicButtonIds } = require('./musicMessages');

async function handleMusicButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('music:') || !interaction.guild) return false;

    if (interaction.customId === musicButtonIds.queue) {
        await interaction.reply({
            ...createQueuePayload(getQueueSummary(interaction.guild.id)),
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

    return false;
}

module.exports = {
    handleMusicButton,
};
