const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDMPermission(false)
		.setDescription('Provides information about the server.'),
	async execute(interaction) {
		const embed = new EmbedBuilder()
		.setTitle('Server Info')
		.setDescription(`**Server's name:** ${interaction.guild.name} *(ID: ${interaction.guild.id})*\n**Server Owner:** <@${interaction.guild.ownerId}> \n**Members:** ${interaction.guild.memberCount}\n**Created:** ${interaction.guild.createdAt.toLocaleString('en-GB', {timeZone: 'GMT', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})}`)		.setColor(blue)
		.setTimestamp()
		.setThumbnail(interaction.guild.iconURL());
		await interaction.reply({ embeds: [embed] });
	},
};