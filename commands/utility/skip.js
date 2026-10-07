const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { MusicControlError, skipMusic } = require('../../services/musicControlService');
const { createStatusPayload } = require('../../utils/musicMessages');

function musicErrorMessage(error) {
    if (error instanceof MusicControlError) return error.message;
    return error?.message || 'There is no active music queue.';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const result = await skipMusic(interaction.client, interaction.guild.id, interaction.user.id)
            .then(() => ({ ok: true }))
            .catch(error => ({ ok: false, error }));
        return interaction.reply(createStatusPayload(
            result.ok ? 'Skipped' : 'Music Error',
            result.ok ? 'Skipped the current track.' : musicErrorMessage(result.error),
            { color: result.ok ? 'blue' : 'orange' },
        ));
    },
};
