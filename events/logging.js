const { Events } = require('discord.js');
const { formatInteractionCommand, truncate } = require('../utils/discord');
const { sendLog, formatUser } = require('../utils/logging');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.guild || interaction.user?.bot) return;
        if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

        const title = interaction.isButton() ? 'Button used' : 'Command used';
        const fields = [
            { name: 'User', value: formatUser(interaction.user), inline: true },
            { name: 'Channel', value: interaction.channel ? `<#${interaction.channel.id}>` : 'Unknown', inline: true },
        ];

        if (interaction.isChatInputCommand()) {
            fields.push({ name: 'Command', value: truncate(formatInteractionCommand(interaction), 1024) });
        }

        if (interaction.isButton()) {
            fields.push({ name: 'Button ID', value: interaction.customId, inline: true });
        }

        await sendLog(interaction.guild, {
            type: 'general',
            title,
            color: 'blue',
            user: interaction.user,
            fields,
        }).catch(error => {
            console.error('Failed to send interaction log:', error);
        });
    },
};
