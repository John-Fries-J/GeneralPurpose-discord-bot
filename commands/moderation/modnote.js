const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const moderationService = require('../../services/moderation');
const { createEmbed } = require('../../utils/embeds');
const { deleteModNote, listModNotes, addUserHistory } = require('../../utils/store');

function formatNote(note) {
    return [
        `ID: ${note.id}`,
        `By: <@${note.moderatorId}>`,
        `At: <t:${Math.floor(note.createdAt / 1000)}:f>`,
        note.note,
    ].join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modnote')
        .setDescription('Manage private staff notes for a user.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a staff note to a user.')
                .addUserOption(option => option.setName('user').setDescription('The user to note.').setRequired(true))
                .addStringOption(option => option.setName('note').setDescription('The note to save.').setMaxLength(1000).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List staff notes for a user.')
                .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a staff note by ID.')
                .addStringOption(option => option.setName('id').setDescription('The note ID.').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const user = interaction.options.getUser('user', true);
            const result = await moderationService.addNote(interaction, {
                user,
                note: interaction.options.getString('note', true),
                source: 'command',
            });

            return interaction.reply({ content: result.ok ? result.content : result.message, flags: 64 });
        }

        if (subcommand === 'delete') {
            const deleted = await deleteModNote(interaction.guild.id, interaction.options.getString('id', true));
            if (deleted) {
                await addUserHistory({
                    guildId: interaction.guild.id,
                    userId: deleted.userId,
                    userTag: deleted.userTag,
                    type: 'modnote:delete',
                    summary: `Deleted note ${deleted.id}: ${deleted.note}`,
                    channelId: interaction.channelId,
                    moderatorId: interaction.user.id,
                    metadata: { noteId: deleted.id },
                });
            }
            return interaction.reply({ content: deleted ? `Deleted mod note ${deleted.id}.` : 'No matching note was found.', flags: 64 });
        }

        const user = interaction.options.getUser('user', true);
        const notes = await listModNotes(interaction.guild.id, user.id, 10);
        const embed = createEmbed({
            title: `Mod notes for ${user.tag}`,
            description: notes.length ? notes.map(formatNote).join('\n\n').slice(0, 4000) : 'No mod notes were found.',
            color: 'blue',
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
