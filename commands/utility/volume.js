const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { getMusicErrorMessage } = require('../../utils/music');
const { setMusicVolume } = require('../../services/musicControlService');
const { createStatusPayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set music playback volume.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Volume percent from 0 to 200.')
                .setMinValue(0)
                .setMaxValue(200)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const summary = await setMusicVolume(interaction.client, interaction.guild.id, interaction.user.id, interaction.options.getInteger('amount', true));
            return interaction.reply(createStatusPayload(
                'Volume Updated',
                `Playback volume is now ${summary.volume}%.`,
            ));
        } catch (error) {
            return interaction.reply(createStatusPayload(
                'Music Error',
                getMusicErrorMessage(error),
                { color: 'red', disabled: true },
            ));
        }
    },
};
