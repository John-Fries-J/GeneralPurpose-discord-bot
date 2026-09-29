const { InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { createEmbed } = require('../../utils/embeds');
const { sendLog, formatUser } = require('../../utils/logging');

async function updateSuggestion(interaction, status) {
    const config = getConfig();
    const messageId = interaction.options.getString('message_id', true);
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (!config.suggestionID) {
        return interaction.reply({ content: 'Suggestion channel is not set up. Check config.json.', flags: 64 });
    }

    const channel = await interaction.client.channels.fetch(config.suggestionID).catch(() => null);
    if (!channel?.messages) {
        return interaction.reply({ content: 'I could not find the suggestion channel.', flags: 64 });
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
        return interaction.reply({ content: 'I could not find that suggestion message.', flags: 64 });
    }

    const originalEmbed = message.embeds[0];
    const embed = createEmbed({
        title: originalEmbed?.title || 'Suggestion',
        description: originalEmbed?.description || 'No suggestion text found.',
        color: status === 'Approved' ? 'green' : 'red',
        fields: [
            ...(originalEmbed?.fields || []).filter(field => field.name !== 'Status' && field.name !== 'Decision Reason'),
            { name: 'Status', value: status, inline: true },
            { name: 'Decision Reason', value: reason },
        ],
        footerText: `Reviewed by ${interaction.user.tag}`,
    });

    await message.edit({ embeds: [embed] });
    if (message.thread) {
        await message.thread.send(`Suggestion ${status.toLowerCase()} by <@${interaction.user.id}>.\nReason: ${reason}`).catch(() => null);
    }

    await sendLog(interaction.guild, {
        type: 'suggestion',
        title: `Suggestion ${status.toLowerCase()}`,
        color: status === 'Approved' ? 'green' : 'red',
        user: interaction.user,
        fields: [
            { name: 'Message ID', value: messageId, inline: true },
            { name: 'Reviewer', value: formatUser(interaction.user), inline: true },
            { name: 'Reason', value: reason },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `Suggestion ${status.toLowerCase()}.`, flags: 64 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Review submitted suggestions.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand =>
            subcommand
                .setName('approve')
                .setDescription('Approve a suggestion.')
                .addStringOption(option => option.setName('message_id').setDescription('The suggestion message ID.').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for approval.')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('deny')
                .setDescription('Deny a suggestion.')
                .addStringOption(option => option.setName('message_id').setDescription('The suggestion message ID.').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for denial.'))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        return updateSuggestion(interaction, subcommand === 'approve' ? 'Approved' : 'Denied');
    },
};
