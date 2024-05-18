const { Events, EmbedBuilder } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        const channelId = config.logChannel;
        const channel = oldMessage.guild.channels.cache.get(channelId) || oldMessage.guild.channels.cache.find(ch => ch.name === 'logs');
        
        if (!channel) {
            console.log('Log channel not found');
            return;
        }

        const logEmbed = new EmbedBuilder()
            .setTitle(`Message edited in ${oldMessage.channel.name}`)
            .setDescription(`Message edited by ${oldMessage.author.tag}\nOld message: ${oldMessage.content}\nNew message: ${newMessage.content}`)
            .setColor(blue)
            .setTimestamp();
        await channel.send({ embeds: [logEmbed] });
    }
};
