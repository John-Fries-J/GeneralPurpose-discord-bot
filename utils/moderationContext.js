const {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { addModNote, addUserHistory } = require('./store');
const { truncate } = require('./discord');

const moderationContextIds = {
    addNotePrefix: 'modctx:add-note:',
};

function createAddModeratorNoteModal(user) {
    const label = truncate(`Note for ${user.username || user.tag || user.id}`, 45);
    return new ModalBuilder()
        .setCustomId(`${moderationContextIds.addNotePrefix}${user.id}`)
        .setTitle('Add Moderator Note')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('note')
                .setLabel(label)
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true),
        ));
}

async function resolveUser(interaction, userId) {
    const fetchedUser = await interaction.client?.users?.fetch?.(userId).catch(() => null);
    if (fetchedUser) return fetchedUser;

    const member = await interaction.guild?.members?.fetch?.(userId).catch(() => null);
    return member?.user || { id: userId, tag: userId };
}

function canModerate(interaction) {
    return interaction.member?.permissions?.has?.(PermissionFlagsBits.ModerateMembers) === true;
}

async function showAddModeratorNoteModal(interaction) {
    await interaction.showModal(createAddModeratorNoteModal(interaction.targetUser));
}

async function handleModerationContextModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.guild) return false;
    if (!interaction.customId.startsWith(moderationContextIds.addNotePrefix)) return false;

    if (!canModerate(interaction)) {
        await interaction.reply({ content: 'You need Moderate Members to add moderator notes.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = interaction.customId.slice(moderationContextIds.addNotePrefix.length);
    const user = await resolveUser(interaction, userId);
    const noteText = interaction.fields.getTextInputValue('note').trim();
    if (!noteText) {
        await interaction.reply({ content: 'Moderator note cannot be empty.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const note = await addModNote({
        guildId: interaction.guild.id,
        userId: user.id,
        userTag: user.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        note: noteText,
    });

    await addUserHistory({
        guildId: interaction.guild.id,
        userId: user.id,
        userTag: user.tag,
        type: 'modnote',
        summary: note.note,
        channelId: interaction.channelId,
        moderatorId: interaction.user.id,
        metadata: { noteId: note.id, source: 'context-menu' },
    });

    await interaction.reply({
        content: `Saved mod note ${note.id} for ${user.tag}.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

module.exports = {
    createAddModeratorNoteModal,
    handleModerationContextModal,
    moderationContextIds,
    showAddModeratorNoteModal,
};
