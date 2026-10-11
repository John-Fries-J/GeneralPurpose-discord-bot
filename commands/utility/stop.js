const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { MusicControlError, stopMusic } = require('../../services/musicControlService');
const { createStatusPayload } = require('../../utils/musicMessages');

function musicErrorMessage(error) {
    if (error instanceof MusicControlError) return error.message;
    return error?.message || 'There is no active music queue.';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and leave voice.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const result = await stopMusic(interaction.client, interaction.guild.id, interaction.user.id)
            .then(() => ({ ok: true }))
            .catch(error => ({ ok: false, error }));
        return interaction.reply(createStatusPayload(
            result.ok ? 'Stopped' : 'Music Error',
            result.ok ? 'Stopped playback and left voice.' : musicErrorMessage(result.error),
            { color: result.ok ? 'blue' : 'orange', disabled: result.ok },
        ));
    },
};
