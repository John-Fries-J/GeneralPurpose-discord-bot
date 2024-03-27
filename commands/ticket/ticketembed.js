const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ChannelType } = require('discord.js');
const { red, green } = require('../../colors.json');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket embed with a button to open a ticket'),
    async execute(interaction, message) {
        const ticketEmbed = new EmbedBuilder()
            .setTitle('Ticket')
            .setDescription('Click the button below to open a ticket.')
            .setColor(red)
            .setTimestamp();


        const ticketChannelId = config.ticketChannel;
        const channel = interaction.guild.channels.cache.get(ticketChannelId);
        const ticketMessage = await channel.send({ embeds: [ticketEmbed] });

        interaction.reply({ content: `Ticket embed has been sent to <#${ticketChannelId}>`, ephemeral: true });

        const ticketButton = new ButtonBuilder()
            .setLabel('Open Ticket')
            .setStyle('Primary')
            .setCustomId('open_ticket');

        ticketMessage.edit({ components: [new ActionRowBuilder().addComponents(ticketButton)] });
        const filter = i => i.customId === 'open_ticket' && i.user.id === interaction.user.id;
        const collector = ticketMessage.createMessageComponentCollector({ filter, time: 15000 });


        collector.on('collect', async i => {
            i.deferUpdate();
            const newChannel = await interaction.guild.channels.create(
                {
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    topic: interaction.user.id,
                    parent: `${config.ticketCategory}`,
                }
            );
              const ticketEmbed = new EmbedBuilder()
                .setTitle(`Ticket has been created!`)
                .setDescription(
                  `Your ticket has been created, while we wait for a member of staff to respond, please provide us with some information about your issue.`
                )
                .setColor(green);
              newChannel.send(`<@${interaction.user.id}>, <@&${config.ticketSupportRole}>`);
              newChannel.send({ embeds: [ticketEmbed] }).then((s) => {
                s.react(`🔒`);
              });
        });
    }};