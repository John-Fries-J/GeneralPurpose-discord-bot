const { SlashCommandBuilder } = require('discord.js');
const { getQueueSummary } = require('../../utils/music');
const { createQueuePayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue.')
        .setDMPermission(false),

    async execute(interaction) {
        return interaction.reply(createQueuePayload(getQueueSummary(interaction.guild.id)));
    },
};
