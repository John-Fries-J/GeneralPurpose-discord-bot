const { SlashCommandBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { getConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { safeDm } = require('../../utils/discord');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDescription('Closes the ticket.'),

    async execute(interaction) {
        const config = getConfig();
        const channel = interaction.channel;

        if (!channel?.name?.startsWith('ticket-')) {
            return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
        }

        const ticketUserId = channel.topic;
        const overwrites = [
            {
                id: interaction.guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
        ];

        if (ticketUserId) {
            overwrites.push({
                id: ticketUserId,
                deny: [PermissionsBitField.Flags.ViewChannel],
            });
        }

        if (config.ticketRole) {
            overwrites.push({
                id: config.ticketRole,
                allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
            });
        }

        await channel.permissionOverwrites.set(overwrites);
        await channel.setName(channel.name.replace('ticket-', 'closed-'));

        if (ticketUserId) {
            const ticketUser = await interaction.client.users.fetch(ticketUserId).catch(() => null);
            if (ticketUser) {
                const dmEmbed = createEmbed({
                    title: language.tickets.closedTitle,
                    description: 'If you need further assistance, please open a new ticket.',
                    color: 'green',
                });
                await safeDm(ticketUser, { embeds: [dmEmbed] });
            }
        }

        await interaction.reply({ content: `Ticket was closed by <@${interaction.user.id}>.` });
    },
};
