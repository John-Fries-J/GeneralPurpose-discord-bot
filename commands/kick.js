const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

module.exports = {

    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server')
        .addUserOption(option => option.setName('user').setDescription('The user to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the kick')),
    async execute(interaction) {
            
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const member = interaction.guild.members.cache.get(user.id);
    
            if (!interaction.member.permissions.has('KICK_MEMBERS')) {
                return await interaction.reply({ content: 'You do not have permission to use this command', ephemeral: true });
            }
    
            if (!member.kickable) {
                return await interaction.reply({ content: 'I cannot kick this user', ephemeral: true });
            }
    
            const embed = new MessageEmbed()
                .setTitle('User Kicked')
                .setColor('RED')
                .setDescription(`You have been kicked from the server${reason ? ` for the following reason: ${reason}` : ''}`)
                .setTimestamp();
    
            await member.send({ embeds: [embed] });
    
            await member.kick({ reason: reason });
    
            await interaction.reply({ content: `User ${user.tag} has been kicked from the server`, ephemeral: true });
        }
}
