const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { red } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmutes a user from the server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addUserOption(option => option.setName('user').setDescription('The user to unmute').setRequired(true)),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user);
        member.timeout(null, 'Unmuted')
        const embed = new EmbedBuilder()
        .setTitle('User Unmute')
        .setDescription(`${member.tag} has been unmuted.`)
        .setColor(red)
        .setTimestamp();
        await interaction.reply({ embeds: [embed] });

        const dmEmbed = new EmbedBuilder()
        .setTitle('User Unmute')
        .setDescription(`You have been unmuted in **${interaction.guild.name}**.`)
        .setColor(red)
        .setTimestamp();
        await member.send({ embeds: [dmEmbed] });
    },
};