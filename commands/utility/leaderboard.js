const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { formatXp, getTotalXp, listLevelLeaderboard } = require('../../utils/leveling');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the XP leaderboard.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option => option
            .setName('type')
            .setDescription('Which XP leaderboard to show.')
            .addChoices(
                { name: 'Total XP', value: 'total' },
                { name: 'Text XP', value: 'text' },
                { name: 'Voice XP', value: 'voice' },
            )),

    async execute(interaction) {
        const type = interaction.options.getString('type') || 'total';
        const records = await listLevelLeaderboard(interaction.guild.id, 10, type);

        if (!records.length) {
            return interaction.reply({ content: `No ${type} XP has been recorded yet.`, flags: 64 });
        }

        const score = record => {
            if (type === 'text') return Number(record.textXp || 0);
            if (type === 'voice') return Number(record.voiceXp || 0);
            return getTotalXp(record);
        };

        const embed = createEmbed({
            title: `${type[0].toUpperCase()}${type.slice(1)} XP Leaderboard`,
            color: 'blue',
            description: records.map((record, index) => {
                return `**${index + 1}.** <@${record.userId}> - **${formatXp(score(record))} XP** (${formatXp(record.textXp)} text, ${formatXp(record.voiceXp)} voice)`;
            }).join('\n'),
        });

        return interaction.reply({ embeds: [embed] });
    },
};
