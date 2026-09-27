const { Events, ButtonBuilder, ActionRowBuilder, ChannelType, PermissionsBitField, ButtonStyle } = require('discord.js');
const language = require('../utils/language');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');
const { formatTemplate } = require('../utils/template');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton() || !interaction.guild) return;
        if (!['open_ticket', 'close_ticket', 'delete_ticket'].includes(interaction.customId)) return;

        const config = getConfig();
        if (!config.ticketCategoryId || !config.ticketRole) {
            return interaction.reply({ content: language.tickets.missingSetup, ephemeral: true });
        }

        if (interaction.customId === 'open_ticket') {
            const existingTicket = interaction.guild.channels.cache.find(channel =>
                channel.parentId === config.ticketCategoryId
                && channel.topic === interaction.user.id
                && channel.name.startsWith('ticket-'));

            if (existingTicket) {
                return interaction.reply({
                    content: formatTemplate(language.tickets.alreadyOpen, { channel: `<#${existingTicket.id}>` }),
                    ephemeral: true,
                });
            }

            const channelName = `ticket-${interaction.user.username}`
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-+/g, '-')
                .slice(0, 90);

            const newChannel = await interaction.guild.channels.create({
                name: channelName || `ticket-${interaction.user.id}`,
                type: ChannelType.GuildText,
                parent: config.ticketCategoryId,
                topic: interaction.user.id,
                permissionOverwrites: [
                    {
                        id: interaction.user.id,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: config.ticketRole,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                    },
                ],
            });

            const ticketEmbed = createEmbed({
                title: language.tickets.createdTitle,
                description: language.tickets.createdDescription,
                color: 'green',
            });
            const closeButton = new ButtonBuilder()
                .setStyle(ButtonStyle.Primary)
                .setLabel(language.tickets.closeButton)
                .setCustomId('close_ticket');

            await newChannel.send({ content: `<@${interaction.user.id}> <@&${config.ticketRole}>`, embeds: [ticketEmbed], components: [new ActionRowBuilder().addComponents(closeButton)] });
            return interaction.reply({ content: `Ticket created: <#${newChannel.id}>`, ephemeral: true });
        }

        if (interaction.customId === 'close_ticket') {
            const channel = interaction.channel;
            if (!channel.name.startsWith('ticket-')) {
                return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
            }

            await channel.edit({
                name: channel.name.replace('ticket-', 'closed-'),
                permissionOverwrites: [
                    {
                        id: channel.topic || interaction.user.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: config.ticketRole,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                    },
                ],
            });

            const closedEmbed = createEmbed({
                title: language.tickets.closedTitle,
                description: language.tickets.closedDescription,
                color: 'red',
            });
            const deleteButton = new ButtonBuilder()
                .setStyle(ButtonStyle.Danger)
                .setLabel(language.tickets.deleteButton)
                .setCustomId('delete_ticket');

            await interaction.reply({ embeds: [closedEmbed], components: [new ActionRowBuilder().addComponents(deleteButton)] });
            return;
        }

        if (interaction.customId === 'delete_ticket') {
            if (!interaction.channel.name.startsWith('closed-')) {
                return interaction.reply({ content: language.tickets.notClosedTicket, ephemeral: true });
            }

            await interaction.reply({ content: 'Deleting ticket...', ephemeral: true });
            await interaction.channel.delete();
        }
    },
};
