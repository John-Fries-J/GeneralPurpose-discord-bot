const { SlashCommandBuilder, PermissionsBitField, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { green } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
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
            const closersTicket = new EmbedBuilder()
                .setTitle('Your ticket has been closed!')
                .setDescription('If you need further assistance, please open a new ticket.')
                .setColor(green);
                const guy = interaction.guild.members.cache.get(ticketUser);
                guy.send({ embeds: [closersTicket] });
        const newName = interaction.channel.name.replace('ticket-', 'closed-');
        await interaction.guild.channels.edit(interaction.channel.id, { name: `${newName}` });
        await interaction.reply({ content: `Ticket was closed by <@${interaction.user.id}>`});
    },
};