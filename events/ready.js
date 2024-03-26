const { Client, Intents } = require('discord.js');
const { statusName } = require('../config.json');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.user.setPresence({ activities: [{ name: `${statusName}` }] });
    },
};
