const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { truncate } = require('../../utils/discord');
const { listModNotes, listUserHistory } = require('../../utils/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Shows database-backed history for a user.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const [history, notes] = await Promise.all([
            listUserHistory(interaction.guild.id, user.id, 20),
            listModNotes(interaction.guild.id, user.id, 20),
        ]);
        const entries = [
            ...history.map(item => ({
                createdAt: item.createdAt,
                type: item.type,
                channelId: item.channelId,
                summary: item.summary,
            })),
            ...notes.map(note => ({
                createdAt: note.createdAt,
                type: 'modnote',
                channelId: null,
                summary: `${note.note} (by ${note.moderatorTag || note.moderatorId})`,
            })),
        ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 15);

        if (!entries.length) {
            return interaction.reply({ content: `${user.tag} has no recorded history.`, flags: 64 });
        }

        const embed = createEmbed({
            title: `History for ${user.tag}`,
            color: 'blue',
            thumbnail: user.displayAvatarURL({ extension: 'png', size: 128 }),
            description: entries.map(item => {
                const timestamp = `<t:${Math.floor(item.createdAt / 1000)}:R>`;
                const channel = item.channelId ? `<#${item.channelId}>` : 'No channel';
                return `${timestamp} **${item.type}** in ${channel}: ${truncate(item.summary, 140)}`;
            }).join('\n'),
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
