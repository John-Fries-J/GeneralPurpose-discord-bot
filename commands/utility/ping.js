const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with the bots Ping'),
	async execute(interaction) {
		const embed = new EmbedBuilder()
		.setTitle('Ping 📈')
		.setDescription(`Ping is: ${interaction.client.ws.ping}ms`)
		.setColor(blue)
		.setTimestamp();
		await interaction.reply({ embeds: [embed] });
	},
};