const { now, parseJson, pruneTableByNewest, stringify } = require('./shared');

function mapHistory(row) {
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        userTag: row.user_tag,
        type: row.type,
        summary: row.summary,
        channelId: row.channel_id,
        moderatorId: row.moderator_id,
        metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at,
    };
}

function mapCommandUsage(row) {
    return {
        guildId: row.guildId,
        channelId: row.channelId,
        command: row.command,
        userId: row.userId,
        userTag: row.userTag,
        ok: row.ok === 1,
        error: row.error,
        createdAt: row.createdAt,
    };
}

function addUserHistory(db, record, maxEntries = 50000) {
    db.prepare(`
        INSERT INTO user_history (guild_id, user_id, user_tag, type, summary, channel_id, moderator_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.guildId, record.userId, record.userTag || null, record.type, record.summary, record.channelId || null, record.moderatorId || null, stringify(record.metadata, {}), record.createdAt || now());
    pruneTableByNewest(db, 'user_history', maxEntries);
    return record;
}

function listUserHistory(db, guildId, userId, limit = 15) {
    return db.prepare('SELECT * FROM user_history WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, userId, limit).map(mapHistory);
}

function listGuildHistory(db, guildId, limit = 200) {
    return db.prepare('SELECT * FROM user_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit).map(mapHistory);
}

function listRecentUserHistory(db, limit = 50000) {
    return db.prepare('SELECT * FROM user_history ORDER BY created_at DESC LIMIT ?').all(limit).map(mapHistory);
}

function recordCommandUsage(db, record, maxEntries = 10000) {
    db.prepare(`
        INSERT INTO command_usage (guild_id, channel_id, command, user_id, user_tag, ok, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.guildId || null, record.channelId || null, record.command, record.userId, record.userTag || null, record.ok === true ? 1 : 0, record.error || null, now());
    pruneTableByNewest(db, 'command_usage', maxEntries);
}

function listCommandStats(db, guildId, since = 0, limit = null) {
    const limited = Number.isInteger(Number(limit)) && Number(limit) > 0;
    const rows = guildId
        ? db.prepare(`SELECT guild_id guildId, channel_id channelId, command, user_id userId, user_tag userTag, ok, error, created_at createdAt FROM command_usage WHERE guild_id = ? AND created_at >= ? ORDER BY created_at DESC${limited ? ' LIMIT ?' : ''}`)
            .all(...(limited ? [guildId, since || 0, Number(limit)] : [guildId, since || 0]))
        : db.prepare(`SELECT guild_id guildId, channel_id channelId, command, user_id userId, user_tag userTag, ok, error, created_at createdAt FROM command_usage WHERE created_at >= ? ORDER BY created_at DESC${limited ? ' LIMIT ?' : ''}`)
            .all(...(limited ? [since || 0, Number(limit)] : [since || 0]));
    return rows.map(mapCommandUsage);
}

module.exports = {
    addUserHistory,
    listCommandStats,
    listGuildHistory,
    listRecentUserHistory,
    listUserHistory,
    mapHistory,
    recordCommandUsage,
};
