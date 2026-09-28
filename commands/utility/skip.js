const { SlashCommandBuilder } = require('discord.js');
const { skip } = require('../../utils/music');
const { createStatusPayload } = require('../../utils/musicMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track.')
        .setDMPermission(false),

    async execute(interaction) {
        const skipped = skip(interaction.guild.id);
        return interaction.reply(createStatusPayload(
            skipped ? 'Skipped' : 'Nothing Playing',
            skipped ? 'Skipped the current track.' : 'There is no active music queue.',
            { color: skipped ? 'blue' : 'orange' },
        ));
    },
};
