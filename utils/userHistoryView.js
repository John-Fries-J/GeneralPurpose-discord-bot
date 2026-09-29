const { createEmbed } = require('./embeds');
const { truncate } = require('./discord');
const { listModNotes, listUserHistory } = require('./store');

async function getUserHistoryEntries(guildId, user, limit = 20) {
    const [history, notes] = await Promise.all([
        listUserHistory(guildId, user.id, limit),
        listModNotes(guildId, user.id, limit),
    ]);
    const noteIds = new Set(notes.map(note => note.id));

    return [
        ...history.filter(item => !(item.type === 'modnote' && noteIds.has(item.metadata?.noteId))).map(item => ({
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
}

function buildUserHistoryEmbed(user, entries) {
    return createEmbed({
        title: `History for ${user.tag}`,
        color: 'blue',
        thumbnail: user.displayAvatarURL?.({ extension: 'png', size: 128 }),
        description: entries.map(item => {
            const timestamp = `<t:${Math.floor(item.createdAt / 1000)}:R>`;
            const channel = item.channelId ? `<#${item.channelId}>` : 'No channel';
            return `${timestamp} **${item.type}** in ${channel}: ${truncate(item.summary, 140)}`;
        }).join('\n'),
    });
}

async function createUserHistoryPayload(guildId, user) {
    const entries = await getUserHistoryEntries(guildId, user);
    if (!entries.length) return { content: `${user.tag} has no recorded history.` };
    return { embeds: [buildUserHistoryEmbed(user, entries)] };
}

module.exports = {
    buildUserHistoryEmbed,
    createUserHistoryPayload,
    getUserHistoryEntries,
};
