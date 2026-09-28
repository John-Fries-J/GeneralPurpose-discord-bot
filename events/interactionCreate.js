const { Events } = require('discord.js');
const { routeInteraction } = require('../interactions/router');
const { logger } = require('../utils/logger');

const interactionLogger = logger.child({ component: 'interactions' });

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        await routeInteraction(interaction).catch(error => {
            interactionLogger.error('Interaction router failed', {
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                userId: interaction.user?.id,
                customId: interaction.customId,
                command: interaction.commandName,
                error,
            });
        });
    },
};
