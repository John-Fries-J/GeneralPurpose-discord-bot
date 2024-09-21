const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Sends welcome embed reminding the user to read the rules.')
        .addUserOption(option => option.setName('user').setDescription('Ping the user with the message')),
    async execute(interaction) {
        if (!$config.welcomeEmbed.title || !$config.welcomeEmbed.description || !$config.welcomeEmbed.footer || !$config.welcomeEmbed.thumbnail) {
            interaction.reply({ content: 'The welcome embed is not set up properly. Please check the config file.', ephemeral: true });
            console.log('The welcome embed is not set up properly. Please check the config file.');
        }
        else if (!interaction.options.getUser('user')) {
            const newembed = new EmbedBuilder()
            .setTitle(`${config.welcomeEmbed.title}`)
            .setDescription(`${config.welcomeEmbed.description}`)
            .setFooter({ text: `${config.welcomeEmbed.footer}` })
            .setThumbnail({ url: `${config.welcomeEmbed.thumbnail}` })
            .setCiolor(blue);     
            interaction.reply({ embeds: [welcomeEmbed] });
        }
        else if (interaction.options.getUser('user')) {
            const user = interaction.options.getUser('user');
            channel = interaction.guild.channels.cache.get(interaction.channelId);
            const newembed = new EmbedBuilder()
            .setTitle(`${config.welcomeEmbed.title}`)
            .setDescription(`${config.welcomeEmbed.description}`)
            .setFooter({ text: `${config.welcomeEmbed.footer}` })
            .setThumbnail({ url: `${config.welcomeEmbed.thumbnail}` })
            .setCiolor(blue);     
            channel.send({content: `${user}`, embeds: [welcomeEmbed] });
            interaction.reply({ content: `Welcome embed has been sent to ${user}`, ephemeral: true });
        }
    }
}