const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');
const { blue } = require('../../colors.json');

async function handleButton(interaction, suggestion, voteType) {
    try {
        let votes = parseInt(suggestion.footer.text.split(' ')[1]);
        if (voteType === 'approve') {
            votes += 1;
        } else if (voteType === 'reject') {
            votes -= 1;
        }
        suggestion.setFooter(`Votes: ${votes}`);
        await interaction.message.edit({ embeds: [suggestion] });
    } catch (error) {
        console.error('Error handling button interaction:', error);
    }
}

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
                .setFooter({ text: 'Votes: 0' }) 
                .setTimestamp();
            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('approve')
                        .setLabel('✅')
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
            const collector = message.createMessageComponentCollector({ componentType: 'BUTTON' });

            collector.on('collect', async buttonInteraction => {
                try {
                    if (buttonInteraction.user.id === user.id) {
                        await buttonInteraction.reply({ content: "You can't vote on your own suggestion.", ephemeral: true });
                        return;
                    }
                    const suggestionEmbed = message.embeds[0];
                    if (buttonInteraction.customId === 'approve') {
                        await handleButton(buttonInteraction, suggestionEmbed, 'approve');
                    } else if (buttonInteraction.customId === 'reject') {
                        await handleButton(buttonInteraction, suggestionEmbed, 'reject');
                    }
                    buttonInteraction.component.setDisabled(true);
                    await buttonInteraction.update({ components: [actionRow] });
                } catch (error) {
                    console.error('Error collecting button interaction:', error);
                }
            });

            collector.on('end', () => {
                try {
                    message.edit({ components: [] });
                } catch (error) {
                    console.error('Error ending button collector:', error);
                }
            });
        } catch (error) {
            console.error('Error executing suggest command:', error);
        }
    },
};
