const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { truncate } = require('../../utils/discord');
const { listUserHistory } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Shows database-backed history for a user.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const history = await listUserHistory(interaction.guild.id, user.id, 15);

        if (!history.length) {
            return interaction.reply({ content: `${user.tag} has no recorded history.`, ephemeral: true });
        }

        const embed = createEmbed({
            title: `History for ${user.tag}`,
            color: 'blue',
            description: history.map(item => {
                const timestamp = `<t:${Math.floor(item.createdAt / 1000)}:R>`;
                const channel = item.channelId ? `<#${item.channelId}>` : 'No channel';
                return `${timestamp} **${item.type}** in ${channel}: ${truncate(item.summary, 140)}`;
            }).join('\n'),
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
