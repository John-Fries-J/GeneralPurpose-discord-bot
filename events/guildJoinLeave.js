const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildCreate,
    once: false,
    execute(guild) {
        console.log(`Joined a new guild: ${guild.name}`);
    },
};
