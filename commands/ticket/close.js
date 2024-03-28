const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Closes the ticket'),
    async execute(interaction) {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return await interaction.reply({ content: 'You can only use this command in a ticket channel', ephemeral: true });
        }
        const ticketUser = interaction.channel.topic;

        await interaction.channel.permissionOverwrites.set([
              {
              id: ticketUser,
              deny: [PermissionsBitField.Flags.ViewChannel]
              },
              {
                id: interaction.guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel],
              },
            ]);
        const newName = interaction.channel.name.replace('ticket-', 'closed-');
        await interaction.guild.channels.edit(interaction.channel.id, { name: `${newName}` });
        await interaction.reply({ content: `Ticket closed was closed by <${interaction.user.id}>`});
    },
};