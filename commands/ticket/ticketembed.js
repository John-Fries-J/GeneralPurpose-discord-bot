const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ChannelType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { red, green } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket embed with a button to open a ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option => option.setName('channel').setDescription('The channel to send the ticket embed to').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The Support Role ID that you want to have access to the tickets').setRequired(true))
        .addChannelOption(option => option.setName('category').setDescription('The category ID you want to have the tickets under').setRequired(true)),
    async execute(interaction) {
        const ticketEmbed = new EmbedBuilder()
            .setTitle('Ticket')
            .setDescription('Click the button below to open a ticket.')
            .setColor(red)
            .setTimestamp();
        const ticketCategoryId = interaction.options.getChannel('category').id;
        const ticketRole = interaction.options.getRole('role').id;
        const ticketChannelId = interaction.options.getChannel('channel').id;
        const channel = interaction.guild.channels.cache.get(ticketChannelId);
        const ticketMessage = await channel.send({ embeds: [ticketEmbed] });
        interaction.reply({ content: `Ticket embed has been sent to <#${ticketChannelId}>`, ephemeral: true });
        const ticketButton = new ButtonBuilder()
            .setLabel('Open Ticket')
            .setStyle('Primary')
            .setCustomId('open_ticket');
        ticketMessage.edit({ components: [new ActionRowBuilder().addComponents(ticketButton)] });
        const filter = i => i.customId === 'open_ticket';
        const collector = ticketMessage.createMessageComponentCollector({ filter, time: 15000 });
        collector.on('collect', async i => {
            i.deferUpdate();
            const newChannel = await interaction.guild.channels.create(
                {
                    name: `ticket-${i.user.username}`,
                    type: ChannelType.GuildText,
                    topic: i.user.id,
                    parent: ticketCategoryId,
                    permissionOverwrites: [
                      {
                        id: i.user.id,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                      },
                      {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                      },
                      {
                        id: ticketRole,
                        allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                      }
                    ]
                }
            );
            const ticketEmbed = new EmbedBuilder()
                .setTitle(`Ticket has been created!`)
                .setDescription(
                  `Your ticket has been created, while we wait for a member of staff to respond, please provide us with some information about your issue.`
                )
                .setColor(green);
            newChannel.send(`<@${i.user.id}>, <@&${ticketRole}>`);
            const ticketedmessage = await newChannel.send({ embeds: [ticketEmbed] });
            const ticketedbutton = new ButtonBuilder()
                  .setStyle("Primary")
                  .setLabel("🔒")
                  .setCustomId("close_ticket");
              
            ticketedmessage.edit({ components: [new ActionRowBuilder().addComponents(ticketedbutton)] });
            const ticketedFilter = j => j.customId === 'close_ticket' && j.user.id === i.user.id;
            const ticketedCollector = ticketedmessage.createMessageComponentCollector({ filter: ticketedFilter, time: 15000 });
            const newName = newChannel.name.replace('ticket-', 'closed-');
            ticketedCollector.on('collect', async j => {
                j.deferUpdate();
              newChannel.edit({
                name: newName,
              permissionOverwrites: [
                {
                id: i.user.id,
                deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                  id: interaction.guild.roles.everyone,
                  deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                  id: ticketRole,
                  allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                }
              ]
              });
              const closedEmbed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setDescription('This ticket has been closed.')
                .setColor(red);
              const closedticket = await newChannel.send({ embeds: [closedEmbed] });
              const closersTicket = new EmbedBuilder()
                .setTitle('You Closed your ticket!')
                .setDescription('You have closed your ticket. If you need further assistance, please open a new ticket.')
                .setColor(green);
              i.user.send({ embeds: [closersTicket] });
              const deletebutton = new ButtonBuilder()
                .setStyle("Danger")
                .setLabel("Delete Ticket")
                .setCustomId("delete_ticket");
              closedticket.edit({ components: [new ActionRowBuilder().addComponents(deletebutton)] });
              const deleteFilter = k => k.customId === 'delete_ticket' && k.user.id === k.user.id;
              const deleteCollector = closedticket.createMessageComponentCollector({ filter: deleteFilter, time: 15000 });
              deleteCollector.on('collect', async k => {
                k.deferUpdate();
                const confirmEmbed = new EmbedBuilder()
                  .setTitle('Are you sure?')
                  .setDescription('Are you sure you want to delete this ticket?')
                  .setColor(red);
                const confirmMessage = await newChannel.send({ embeds: [confirmEmbed] });
                const confirmbutton = new ButtonBuilder()
                  .setStyle("Danger")
                  .setLabel("Confirm")
                  .setCustomId("confirm_delete");
                const cancelbutton = new ButtonBuilder()
                  .setStyle("Primary")
                  .setLabel("Cancel")
                  .setCustomId("cancel_delete");
                confirmMessage.edit({ components: [new ActionRowBuilder().addComponents(confirmbutton, cancelbutton)] });
                const confirmFilter = l => l.customId === 'confirm_delete' && l.user.id === k.user.id;
                const confirmCollector = confirmMessage.createMessageComponentCollector({ filter: confirmFilter, time: 15000 });
                confirmCollector.on('collect', async l => {
                  l.deferUpdate();
                  newChannel.delete();
                });
                const cancelFilter = m => m.customId === 'cancel_delete' && m.user.id === k.user.id;
                const cancelCollector = confirmMessage.createMessageComponentCollector({ filter: cancelFilter, time: 15000 });
                cancelCollector.on('collect', async m => {
                  m.deferUpdate();
                  const cancelledEmbed = new EmbedBuilder()
                    .setTitle('Ticket Deletion Cancelled')
                    .setDescription('This ticket will not be deleted.')
                    .setColor(green);
                    newChannel.send({ embeds: [cancelledEmbed] });
              });
            });
        });
          });
          }
      }