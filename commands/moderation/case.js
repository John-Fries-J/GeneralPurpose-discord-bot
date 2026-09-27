const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { getModerationCase } = require('../../utils/store');

function formatDate(timestamp) {
    return timestamp ? `<t:${Math.floor(timestamp / 1000)}:f>` : 'Unknown';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Shows a moderation case.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(option => option.setName('id').setDescription('The case ID.').setMinValue(1).setRequired(true)),

    async execute(interaction) {
        const caseId = interaction.options.getInteger('id', true);
        const record = await getModerationCase(interaction.guild.id, caseId);

        if (!record) {
            return interaction.reply({ content: `Case #${caseId} was not found.`, ephemeral: true });
        }

        const embed = createEmbed({
            title: `Case #${record.id}`,
            color: record.active === false ? 'blue' : 'orange',
            fields: [
                { name: 'Type', value: record.type, inline: true },
                { name: 'Status', value: record.active === false ? 'Cleared' : 'Active', inline: true },
                { name: 'User', value: `<@${record.userId}> (${record.userTag || record.userId})` },
                { name: 'Moderator', value: `<@${record.moderatorId}> (${record.moderatorTag || record.moderatorId})` },
                { name: 'Reason', value: record.reason || 'No reason' },
                { name: 'Created', value: formatDate(record.createdAt), inline: true },
                ...(record.duration ? [{ name: 'Duration', value: record.duration, inline: true }] : []),
                ...(record.clearReason ? [{ name: 'Clear reason', value: record.clearReason }] : []),
            ],
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
