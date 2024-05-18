const { Events, EmbedBuilder } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.ThreadUpdate,
    async execute(oldThread, newThread) {
        const channelId = config.logChannel;
        const channel = oldThread.guild.channels.cache.get(channelId) || oldThread.guild.channels.cache.find(ch => ch.name === 'logs');
        
        if (!channel) {
            console.log('Log channel not found');
            return;
        }

        const logEmbed = new EmbedBuilder()
            .setTitle(`Thread edited in ${oldThread.parent.name}`)
            .setDescription(`Thread edited by <@${oldThread.ownerId}>\nOld thread: ${oldThread.name}\nNew thread: ${newThread.name}`)
            .setColor(blue)
            .setTimestamp();
        await channel.send({ embeds: [logEmbed] });
    }
};
