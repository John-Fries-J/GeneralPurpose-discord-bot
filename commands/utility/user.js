const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('Provides information about the user.')
        .addUserOption(option => option.setName('user').setDescription('Gather info about another user')),
    async execute(interaction) {
        if (!interaction.options.getUser('user')) {
            const user = interaction.user;

            const userEmbed = new EmbedBuilder()
                .setTitle('User Info')
                .setDescription(`**User\'s name:** ${user.tag } *(ID: ${user.id})*\n**Account Created:** ${user.createdAt.toLocaleString('en-GB', {timeZone: 'GMT', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}\n**Joined __${interaction.guild.name}__:** ${interaction.member.joinedAt.toLocaleString('en-GB', {timeZone: 'GMT', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}`)
                .setColor(blue)
                .setTimestamp()
                .setThumbnail(user.avatarURL());

            interaction.reply({ embeds: [userEmbed] });
        }
        if (interaction.options.getUser('user')) {
            const user = interaction.options.getUser('user');

            const userEmbed = new EmbedBuilder()
                .setTitle('User Info')
                .setDescription(`**User\'s name:** ${user.tag} *(ID: ${user.id})* \n**Account Created:** ${user.createdAt.toLocaleString('en-GB', {timeZone: 'GMT', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}\n**Joined__ ${interaction.guild.name}__:** ${interaction.member.joinedAt.toLocaleString('en-GB', {timeZone: 'GMT', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}`)
                .setColor(blue)
                .setTimestamp()
                .setThumbnail(user.avatarURL());

            interaction.reply({ embeds: [userEmbed] });
        }
    },
};