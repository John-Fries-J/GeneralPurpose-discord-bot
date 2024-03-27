const { Events, EmbedBuilder } = require('discord.js');
const { blue } = require('../colors.json');
const config = require('../config.json');

module.exports = {

    name: Events.InteractionCreate,

    async execute(interaction) {
            const channelId = `${config.logChannel}`;
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) return console.log('Log channel not found');
            const logEmbed = new EmbedBuilder()
                .setTitle(`${interaction.user.tag} ran a command`)
                .setDescription(`Command ran in ${interaction.channel}, by ${interaction.user.tag}.\nCommand: ${interaction.commandName}\n[Click here to be taken there](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${interaction.id})`)
                .setColor(blue)
                .setTimestamp();
            channel.send({ embeds: [logEmbed] });
    
        }
};
