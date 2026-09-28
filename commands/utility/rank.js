const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const {
    formatProgressBar,
    getLevelProgress,
    getUserLevelRecord,
} = require('../../utils/leveling');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level and XP progress.')
        .setDMPermission(false)
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

        const progress = getLevelProgress(record);
        const percent = Math.floor(progress.percent * 100);
        const embed = createEmbed({
            title: `${user.username}'s Rank`,
            color: 'blue',
            thumbnail: user.displayAvatarURL({ extension: 'png', size: 128 }),
            fields: [
                { name: 'Level', value: `${progress.level}`, inline: true },
                { name: 'Total XP', value: `${progress.totalXp}`, inline: true },
                { name: 'Next level', value: `${progress.progressXp}/${progress.neededXp} XP (${percent}%)`, inline: false },
                { name: 'Progress', value: `\`${formatProgressBar(progress.percent)}\``, inline: false },
                { name: 'Breakdown', value: `${record.textXp || 0} text XP\n${record.voiceXp || 0} voice XP`, inline: true },
            ],
        });

        return interaction.reply({ embeds: [embed] });
    },
};
