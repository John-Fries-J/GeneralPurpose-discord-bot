const { Events } = require('discord.js');
const { routeInteraction } = require('../interactions/router');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        await routeInteraction(interaction).catch(error => {
            console.error('Interaction router failed:', error);
        });
    },
};
