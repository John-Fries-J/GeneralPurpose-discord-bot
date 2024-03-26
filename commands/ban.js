const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

module.exports = {

    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server')
        .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban')),
    async execute(interaction) {
            
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const member = interaction.guild.members.cache.get(user.id);
    
            if (!interaction.member.permissions.has('BAN_MEMBERS')) {
                return await interaction.reply({ content: 'You do not have permission to use this command', ephemeral: true });
            }
    
            if (!member.bannable) {
                return await interaction.reply({ content: 'I cannot ban this user', ephemeral: true });
            }
    
            const embed = new MessageEmbed()
                .setTitle('User Banned')
                .setColor('RED')
                .setDescription(`You have been banned from the server${reason ? ` for the following reason: ${reason}` : ''}`)
                .setTimestamp();
    
            await member.send({ embeds: [embed] });
    
            await member.ban({ reason: reason });
    
            await interaction.reply({ content: `User ${user.tag} has been banned from the server`, ephemeral: true });
        }
}
