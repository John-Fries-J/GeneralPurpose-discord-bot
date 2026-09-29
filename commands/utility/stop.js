const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { stop } = require('../../utils/music');
const { createStatusPayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and leave voice.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const stopped = stop(interaction.guild.id);
        return interaction.reply(createStatusPayload(
            stopped ? 'Stopped' : 'Nothing Playing',
            stopped ? 'Stopped playback and left voice.' : 'There is no active music queue.',
            { color: stopped ? 'blue' : 'orange', disabled: true },
        ));
    },
};
