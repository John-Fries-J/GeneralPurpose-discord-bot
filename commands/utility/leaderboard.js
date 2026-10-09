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
            ))
        .addIntegerOption(option => option
            .setName('page')
            .setDescription('Leaderboard page.')
            .setMinValue(1)
            .setMaxValue(100000))
        .addBooleanOption(option => option
            .setName('current_members_only')
            .setDescription('Show only current server members; stored departed-member records are preserved.')),

    async execute(interaction) {
        const type = interaction.options.getString('type') || 'total';
        const page = interaction.options.getInteger('page') || 1;
        const currentMembersOnly = interaction.options.getBoolean('current_members_only') === true;
        const pageSize = 10;
        const offset = (page - 1) * pageSize;
        let records = await listLevelLeaderboard(interaction.guild.id, pageSize, type, offset);

        if (currentMembersOnly) {
            let memberIds = null;
            try {
                const fetched = await interaction.guild.members.fetch();
                memberIds = new Set([...(fetched?.keys?.() || interaction.guild.members.cache.keys())].map(String));
            } catch {
                memberIds = new Set([...(interaction.guild.members.cache?.keys?.() || [])].map(String));
            }
            records = (await listLevelLeaderboard(interaction.guild.id, 100000, type, 0))
                .filter(record => memberIds.has(String(record.userId)))
                .slice(offset, offset + pageSize);
        }

        if (!records.length) {
            return interaction.reply({ content: currentMembersOnly ? `No current members have recorded ${type} XP on this page.` : `No ${type} XP has been recorded yet.`, flags: 64 });
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
                return `**${offset + index + 1}.** <@${record.userId}> - **${formatXp(score(record))} XP** (${formatXp(record.textXp)} text, ${formatXp(record.voiceXp)} voice)`;
            }).join('\n'),
            footerText: currentMembersOnly ? `Page ${page} - current members only` : `Page ${page}`,
        });

        return interaction.reply({ embeds: [embed] });
    },
};
