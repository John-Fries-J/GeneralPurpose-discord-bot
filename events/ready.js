const { Client, Intents } = require('discord.js');
const { statusName } = require('../config.json');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        if (!statusName) return console.log('No status name provided in config.json')
        else {
        client.user.setPresence({ activities: [{ name: `${statusName}` }] });
    }
    },
};
