const { Client, Intents, EmbedBuilder } = require('discord.js');
const { statusName, logChannels } = require('../config.json');
const { green } = require('../colors.json');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        const channelId = logChannels.logChannel;
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.log('Log channel not found');
            return;
        }
        const logEmbed = new EmbedBuilder()
            .setTitle('Bot is ready')
            .setDescription('Bot is now online and ready to use')
            .setColor(green)
            .setTimestamp();
        channel.send({ embeds: [logEmbed] });
        if (!statusName) return console.log('No status name provided in config.json')
        else {
        client.user.setPresence({ activities: [{ name: `${statusName}` }] });
    }
    },
};
