const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const language = require('../../utils/language');
const { formatTemplate } = require('../../utils/template');

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
            return interaction.reply({ content: language.moderation.purgeRange, ephemeral: true });
        }

        try {
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({
                content: formatTemplate(language.moderation.purgeSuccess, { amount: deleted.size }),
                ephemeral: true,
            });
        } catch (error) {
            console.error('Purge failed:', error);
            await interaction.reply({ content: `There was an error trying to delete messages in this channel: ${error.message}`, ephemeral: true });
        }
    },
};
