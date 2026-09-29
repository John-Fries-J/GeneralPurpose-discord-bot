const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const {
    formatXp,
    formatProgressBar,
    getGuildLevelingConfig,
    getLevelProgress,
    getUserLevelRecord,
    listLevelLeaderboard,
} = require('../../utils/leveling');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level and XP progress.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addUserOption(option => option.setName('user').setDescription('User to inspect. Defaults to you.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const record = await getUserLevelRecord(interaction.guild.id, user.id);

        if (!record) {
            return interaction.reply({
                content: user.id === interaction.user.id
                    ? 'You do not have any XP yet.'
                    : `${user.tag} does not have any XP yet.`,
                flags: 64,
            });
        }

        const settings = await getGuildLevelingConfig(interaction.guild.id);
        const progress = getLevelProgress(record, settings);
        const percent = Math.floor(progress.percent * 100);
        const leaderboard = await listLevelLeaderboard(interaction.guild.id, 1000, 'total');
        const placement = leaderboard.findIndex(item => item.userId === user.id);
        const textXp = Number(record.textXp || 0);
        const voiceXp = Number(record.voiceXp || 0);
        const total = Math.max(1, textXp + voiceXp);
        const textPercent = Math.round((textXp / total) * 100);
        const voicePercent = Math.round((voiceXp / total) * 100);

        const embed = createEmbed({
            title: `${user.username}'s Rank`,
            color: 'blue',
            thumbnail: user.displayAvatarURL({ extension: 'png', size: 128 }),
            description: [
                `**Level ${progress.level}** with **${formatXp(progress.totalXp)} XP**`,
                `Server placement: **${placement === -1 ? 'Unranked' : `#${placement + 1}`}**`,
            ].join('\n'),
            fields: [
                { name: 'Next Level', value: `${formatXp(progress.progressXp)} / ${formatXp(progress.neededXp)} XP (${percent}%)`, inline: false },
                { name: 'Progress', value: `\`${formatProgressBar(progress.percent)}\``, inline: false },
                {
                    name: 'Breakdown',
                    value: [
                        `Text: **${formatXp(textXp)} XP** (${textPercent}%)`,
                        `Voice: **${formatXp(voiceXp)} XP** (${voicePercent}%)`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: 'Totals',
                    value: [
                        `Current level starts at ${formatXp(progress.currentLevelXp)} XP`,
                        `Next level at ${formatXp(progress.nextLevelXp)} XP`,
                    ].join('\n'),
                    inline: true,
                },
            ],
        });

        return interaction.reply({ embeds: [embed] });
    },
};
