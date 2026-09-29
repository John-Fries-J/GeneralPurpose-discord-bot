const { SlashCommandBuilder } = require('discord.js');
const { getMusicErrorMessage, setVolume } = require('../../utils/music');
const { createStatusPayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set music playback volume.')
        .setDMPermission(false)
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Volume percent from 0 to 200.')
                .setMinValue(0)
                .setMaxValue(200)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const queue = setVolume(interaction.guild.id, interaction.options.getInteger('amount', true));
            return interaction.reply(createStatusPayload(
                'Volume Updated',
                `Playback volume is now ${queue.volume}%.`,
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
