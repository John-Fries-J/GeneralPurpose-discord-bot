const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('member')
		.setDescription('Lists all members within a role.')
		.addRoleOption(option => option.setName('role').setDescription('The role to list members from').setRequired(true)),
	async execute(interaction) {
		const role = interaction.options.getRole('role');
		const membersWithRole = interaction.guild.members.cache.filter(member => member.roles.cache.has(role.id));
		const mentions = membersWithRole
			.map(member => `<@${member.id}>`)
			.slice(0, 90);

		const embed = new EmbedBuilder()
			.setTitle('Members with the role:')
			.setDescription(mentions.join('\n') || 'No members found with this role.')
			.setColor(blue)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	},
};
