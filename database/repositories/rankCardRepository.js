const { now } = require('./shared');

function mapRankCardPreference(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        backgroundType: row.background_type,
        backgroundKey: row.background_key,
        accentColor: row.accent_color,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapRankCardBackground(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        backgroundId: row.background_id,
        name: row.name,
        assetPath: row.asset_path,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function getRankCardPreference(db, guildId, userId) {
    return mapRankCardPreference(db.prepare('SELECT * FROM rank_card_preferences WHERE guild_id = ? AND user_id = ?').get(guildId, userId));
}

function listRankCardPreferences(db, guildId = null) {
    const rows = guildId
        ? db.prepare('SELECT * FROM rank_card_preferences WHERE guild_id = ? ORDER BY updated_at DESC').all(guildId)
        : db.prepare('SELECT * FROM rank_card_preferences ORDER BY updated_at DESC').all();
    return rows.map(mapRankCardPreference);
}

function upsertRankCardPreference(db, record) {
    const timestamp = now();
    const existing = getRankCardPreference(db, record.guildId, record.userId);
    const createdAt = record.createdAt || existing?.createdAt || timestamp;
    db.prepare(`
        INSERT INTO rank_card_preferences (
            guild_id,
            user_id,
            background_type,
            background_key,
            accent_color,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            background_type = excluded.background_type,
            background_key = excluded.background_key,
            accent_color = excluded.accent_color,
            updated_at = excluded.updated_at
    `).run(
        record.guildId,
        record.userId,
        record.backgroundType || 'default',
        record.backgroundKey || null,
        record.accentColor || null,
        createdAt,
        record.updatedAt || timestamp,
    );
    return getRankCardPreference(db, record.guildId, record.userId);
}

function deleteRankCardPreference(db, guildId, userId) {
    return db.prepare('DELETE FROM rank_card_preferences WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}

function getRankCardBackground(db, guildId, backgroundId) {
    return mapRankCardBackground(db.prepare('SELECT * FROM rank_card_backgrounds WHERE guild_id = ? AND background_id = ?').get(guildId, backgroundId));
}

function listRankCardBackgrounds(db, guildId = null) {
    const rows = guildId
        ? db.prepare('SELECT * FROM rank_card_backgrounds WHERE guild_id = ? ORDER BY name ASC').all(guildId)
        : db.prepare('SELECT * FROM rank_card_backgrounds ORDER BY guild_id ASC, name ASC').all();
    return rows.map(mapRankCardBackground);
}

function upsertRankCardBackground(db, record) {
    const timestamp = now();
    const existing = getRankCardBackground(db, record.guildId, record.backgroundId);
    const createdAt = record.createdAt || existing?.createdAt || timestamp;
    db.prepare(`
        INSERT INTO rank_card_backgrounds (
            guild_id,
            background_id,
            name,
            asset_path,
            created_by,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, background_id) DO UPDATE SET
            name = excluded.name,
            asset_path = excluded.asset_path,
            created_by = excluded.created_by,
            updated_at = excluded.updated_at
    `).run(
        record.guildId,
        record.backgroundId,
        record.name,
        record.assetPath,
        record.createdBy || null,
        createdAt,
        record.updatedAt || timestamp,
    );
    return getRankCardBackground(db, record.guildId, record.backgroundId);
}

function deleteRankCardBackground(db, guildId, backgroundId) {
    return db.prepare('DELETE FROM rank_card_backgrounds WHERE guild_id = ? AND background_id = ?').run(guildId, backgroundId).changes;
}

module.exports = {
    deleteRankCardBackground,
    deleteRankCardPreference,
    getRankCardBackground,
    getRankCardPreference,
    listRankCardBackgrounds,
    listRankCardPreferences,
    mapRankCardBackground,
    mapRankCardPreference,
    upsertRankCardBackground,
    upsertRankCardPreference,
};
