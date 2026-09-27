const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { findSendableChannel } = require('../utils/discord');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.guild || interaction.user?.bot) return;

        const config = getConfig();
        const channel = findSendableChannel(interaction.guild, config.logChannels?.logChannel, 'logs');
        if (!channel) return;

        const isButton = interaction.isButton();
        const title = isButton
            ? `${interaction.user.tag} clicked a button`
            : `${interaction.user.tag} ran a command`;
        const description = isButton
            ? `${interaction.user.tag} clicked ${interaction.customId} in ${interaction.channel}.`
            : `Command ran in ${interaction.channel} by ${interaction.user.tag}.\nCommand: /${interaction.commandName}`;

        const logEmbed = createEmbed({
            title,
            description,
            color: 'blue',
        });

        await channel.send({ embeds: [logEmbed] }).catch(error => {
            console.error('Failed to send interaction log:', error);
        });
    },
};
