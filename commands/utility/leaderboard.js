const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { getTotalXp, listLevelLeaderboard } = require('../../utils/leveling');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the XP leaderboard.')
        .setDMPermission(false),

    async execute(interaction) {
        const records = await listLevelLeaderboard(interaction.guild.id, 10);

        if (!records.length) {
            return interaction.reply({ content: 'No XP has been recorded yet.', flags: 64 });
        }

        const embed = createEmbed({
            title: 'XP Leaderboard',
            color: 'blue',
            description: records.map((record, index) => {
                return `${index + 1}. <@${record.userId}> - ${getTotalXp(record)} total (${record.textXp || 0} text, ${record.voiceXp || 0} voice)`;
            }).join('\n'),
        });

        return interaction.reply({ embeds: [embed] });
    },
};
