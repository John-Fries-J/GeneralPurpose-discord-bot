module.exports = {
    name: 'guildCreate',
    once: false,
    execute(guild) {
        console.log(`Joined a new guild: ${guild.name}`);
    },
};
