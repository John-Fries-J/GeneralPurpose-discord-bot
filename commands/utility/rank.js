const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const {
    formatXp,
    formatProgressBar,
    getGuildLevelingConfig,
    getLevelRank,
    getLevelProgress,
    getUserLevelRecord,
} = require('../../utils/leveling');
const { createRankCardAttachment } = require('../../utils/rankCard');
const { getRankCardPreference, listRankCardBackgrounds } = require('../../utils/store');

function displayUserForRank(user, member) {
    return {
        id: user.id,
        username: user.username,
        tag: user.tag,
        globalName: user.globalName,
        displayName: member?.displayName || user.globalName || user.username || user.tag || user.id,
        displayAvatarURL: options => member?.displayAvatarURL?.(options) || user.displayAvatarURL?.(options),
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level and XP progress.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addUserOption(option => option.setName('user').setDescription('User to inspect. Defaults to you.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = interaction.options.getMember('user') || (user.id === interaction.user.id ? interaction.member : null);
        const displayUser = displayUserForRank(user, member);
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
        const placement = await getLevelRank(interaction.guild.id, user.id, 'total');
        const textXp = Number(record.textXp || 0);
        const voiceXp = Number(record.voiceXp || 0);
        const total = Math.max(1, textXp + voiceXp);
        const textPercent = Math.round((textXp / total) * 100);
        const voicePercent = Math.round((voiceXp / total) * 100);

        const embed = createEmbed({
            title: `${displayUser.displayName}'s Rank`,
            color: 'blue',
            thumbnail: displayUser.displayAvatarURL({ extension: 'png', size: 128 }),
            description: [
                `**Level ${progress.level}** with **${formatXp(progress.totalXp)} XP**`,
                `Server placement: **${placement ? `#${placement}` : 'Unranked'}**`,
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

        if (settings.rankCard?.enabled !== false) {
            await interaction.deferReply();
            try {
                const [preference, backgrounds] = await Promise.all([
                    getRankCardPreference(interaction.guild.id, user.id),
                    listRankCardBackgrounds(interaction.guild.id),
                ]);
                const attachment = await createRankCardAttachment({
                    guildId: interaction.guild.id,
                    user: displayUser,
                    progress,
                    rank: placement,
                    record,
                    settings,
                    preference,
                    backgrounds,
                });
                return await interaction.editReply({ files: [attachment] });
            } catch (error) {
                console.error('Failed to send graphical rank card, using embed fallback:', error);
                return interaction.editReply({ embeds: [embed] });
            }
        }

        return interaction.reply({ embeds: [embed] });
    },
};
