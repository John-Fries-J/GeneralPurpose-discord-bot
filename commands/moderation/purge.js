const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { formatTemplate } = require('../../utils/template');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Deletes a specified amount of messages.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option => option.setName('amount').setDescription('The amount of messages to delete.').setRequired(true).setMinValue(1).setMaxValue(100)),

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);

        if (amount < 1 || amount > 100) {
            return interaction.reply({ content: language.moderation.purgeRange, flags: 64 });
        }

        try {
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await sendLog(interaction.guild, {
                type: 'moderation',
                title: 'Messages purged',
                color: 'orange',
                user: interaction.user,
                fields: [
                    { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                    { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: true },
                    { name: 'Deleted', value: `${deleted.size}`, inline: true },
                ],
            }).catch(() => null);

            await interaction.reply({
                content: formatTemplate(language.moderation.purgeSuccess, { amount: deleted.size }),
                flags: 64,
            });
        } catch (error) {
            console.error('Purge failed:', error);
            await interaction.reply({ content: `There was an error trying to delete messages in this channel: ${error.message}`, flags: 64 });
        }
    },
};
