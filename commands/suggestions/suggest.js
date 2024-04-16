const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Suggest a feature for the server.')
        .addStringOption(option => option.setName('suggestion').setDescription('The suggestion you want to make.').setRequired(true)),
        async execute(interaction) {
            try {
                const suggestionContent = interaction.options.getString('suggestion');
                const user = interaction.user;
                const embed = new EmbedBuilder()
                    .setThumbnail(user.avatarURL())
                    .setDescription(`**Submitter:**\n ${user.tag} \n\n**Suggestion**\n${suggestionContent}`)
                    .setColor(blue)
                    .setTimestamp();
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('approve')
                            .setLabel(`✅`)
                            .setStyle('Success'),
                        new ButtonBuilder()
                            .setCustomId('reject')
                            .setLabel('❌')
                            .setStyle('Danger')
                    );
                const channel = interaction.guild.channels.cache.find(channel => channel.name === 'suggestions');
                if (!channel) {
                    await interaction.reply({ content: 'Could not find a channel named suggestions. Pester the bot devs to make one', ephemeral: true });
                    return;
                }
                const message = await channel.send({ embeds: [embed], components: [actionRow] });
                await interaction.reply({ content: 'Suggestion submitted!', ephemeral: true });
        
                const collector = message.createMessageComponentCollector({ componentType: 'BUTTON', time: 60000 }); // 60 seconds timeout
        
                collector.on('collect', async buttonInteraction => {
                    const button = buttonInteraction.customId;
                    if (button === 'approve') {
                        await buttonInteraction.update({ components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('approve')
                                .setLabel(`✅ Approved`)
                                .setStyle('Success')
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('reject')
                                .setLabel('❌ Rejected')
                                .setStyle('Danger')
                                .setDisabled(true)
                        )] });
                    } else if (button === 'reject') {
                        await buttonInteraction.update({ components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('approve')
                                .setLabel(`✅ Approved`)
                                .setStyle('Success')
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('reject')
                                .setLabel('❌ Rejected')
                                .setStyle('Danger')
                                .setDisabled(true)
                        )] });
                    }
                });
        
                collector.on('end', collected => {
                    console.log(`Collected ${collected.size} interactions.`);
                });
        
            } catch (error) {
                console.error('Error executing suggest command:', error);
            }
        },        
};
