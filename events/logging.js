const { Events, EmbedBuilder } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        const channelId = `${config.logChannel}`;
        const channel = interaction.guild.channels.cache.get(channelId) || interaction.guild.channels.cache.find(channel => channel.name === 'logs');
        
        if (!channel) {
            console.log('Log channel not found');
            return;
        }

        if (interaction.isButton()) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`${interaction.user.tag} Clicked a button`)
                .setDescription(`${interaction.user.tag} clicked a button in ${interaction.channel}`)
                .setColor(blue)
                .setTimestamp();
            channel.send({ embeds: [logEmbed] });
        } else {
            const logEmbed = new EmbedBuilder()
                .setTitle(`${interaction.user.tag} ran a command`)
                .setDescription(`Command ran in ${interaction.channel}, by ${interaction.user.tag}.\nCommand: ${interaction.commandName}\n[Go there](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${interaction.id})`)
                .setColor(blue)
                .setTimestamp();
            channel.send({ embeds: [logEmbed] });
        }
    }
};
