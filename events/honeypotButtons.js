const { Events } = require('discord.js');
const { handleHoneypotButton } = require('../utils/honeypot');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        await handleHoneypotButton(interaction);
    },
};
