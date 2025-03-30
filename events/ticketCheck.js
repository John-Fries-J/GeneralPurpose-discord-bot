const { Events, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const fs = require('fs');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        if (!config.ticketMessageID) return;

        if (interaction.customId === 'open_ticket') {
            await interaction.deferUpdate();

            const newChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
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
                    }
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setTitle(`Ticket Created!`)
                .setDescription('Please provide details about your issue while waiting for staff assistance.')
                .setColor('Green');

            await newChannel.send(`<@${interaction.user.id}>, <@&${config.ticketRole}>`);
            const ticketMessage = await newChannel.send({ embeds: [ticketEmbed] });

            const closeButton = new ButtonBuilder()
                .setStyle('Primary')
                .setLabel('🔒 Close Ticket')
                .setCustomId('close_ticket');

            await ticketMessage.edit({ components: [new ActionRowBuilder().addComponents(closeButton)] });
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.deferUpdate();
            const channel = interaction.channel;

            await channel.edit({
                name: channel.name.replace('ticket-', 'closed-'),
                permissionOverwrites: [
                    {
                        id: interaction.user.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: config.ticketRole,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel]
                    }
                ]
            });

            const closedEmbed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setDescription('This ticket has been closed.')
                .setColor('Red');

            await channel.send({ embeds: [closedEmbed] });

            const deleteButton = new ButtonBuilder()
                .setStyle('Danger')
                .setLabel('Delete Ticket')
                .setCustomId('delete_ticket');

            await channel.send({ components: [new ActionRowBuilder().addComponents(deleteButton)] });
        }

        if (interaction.customId === 'delete_ticket') {
            await interaction.deferUpdate();
            await interaction.channel.delete();
        }
    }
};
