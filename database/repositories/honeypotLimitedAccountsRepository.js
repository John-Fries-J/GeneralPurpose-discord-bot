const { now, parseJson, stringify } = require('./shared');

const LIMITED_ACCOUNT_STATUS = {
    ACTIVE: 'active',
    FAILED: 'failed',
    RESTORED: 'restored',
};

function mapLimitedAccount(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        previousRoleIds: parseJson(row.previous_role_ids_json, []),
        limitedRoleId: row.limited_role_id,
        limitedChannelId: row.limited_channel_id,
        limitedBy: row.limited_by,
        limitedAt: row.limited_at,
        restoredBy: row.restored_by,
        restoredAt: row.restored_at,
        restorationSource: row.restoration_source,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function getLimitedAccount(db, guildId, userId) {
    return mapLimitedAccount(db.prepare('SELECT * FROM honeypot_limited_accounts WHERE guild_id = ? AND user_id = ?').get(guildId, userId));
}

function listLimitedAccounts(db, guildId = null) {
    const rows = guildId
        ? db.prepare('SELECT * FROM honeypot_limited_accounts WHERE guild_id = ? ORDER BY updated_at DESC').all(guildId)
        : db.prepare('SELECT * FROM honeypot_limited_accounts ORDER BY updated_at DESC').all();
    return rows.map(mapLimitedAccount);
}

function upsertLimitedAccount(db, record) {
    const timestamp = now();
    const createdAt = record.createdAt || timestamp;
    const updatedAt = record.updatedAt || timestamp;
    db.prepare(`
        INSERT INTO honeypot_limited_accounts (
            guild_id,
            user_id,
            previous_role_ids_json,
            limited_role_id,
            limited_channel_id,
            limited_by,
            limited_at,
            restored_by,
            restored_at,
            restoration_source,
            status,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            previous_role_ids_json = excluded.previous_role_ids_json,
            limited_role_id = excluded.limited_role_id,
            limited_channel_id = excluded.limited_channel_id,
            limited_by = excluded.limited_by,
            limited_at = excluded.limited_at,
            restored_by = excluded.restored_by,
            restored_at = excluded.restored_at,
            restoration_source = excluded.restoration_source,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
    `).run(
        record.guildId,
        record.userId,
        stringify(record.previousRoleIds, []),
        record.limitedRoleId,
        record.limitedChannelId || null,
        record.limitedBy || null,
        Number(record.limitedAt || timestamp),
        record.restoredBy || null,
        record.restoredAt || null,
        record.restorationSource || null,
        record.status || LIMITED_ACCOUNT_STATUS.ACTIVE,
        createdAt,
        updatedAt,
    );
    return getLimitedAccount(db, record.guildId, record.userId);
}

function beginLimitedAccount(db, record) {
    return db.transaction(() => {
        const existing = getLimitedAccount(db, record.guildId, record.userId);
        if (existing?.status === LIMITED_ACCOUNT_STATUS.ACTIVE) {
            return { ok: false, record: existing };
        }

        const timestamp = now();
        const account = {
            ...record,
            restoredBy: null,
            restoredAt: null,
            restorationSource: null,
            status: LIMITED_ACCOUNT_STATUS.ACTIVE,
            limitedAt: record.limitedAt || timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        return { ok: true, record: upsertLimitedAccount(db, account) };
    })();
}

function markLimitedAccountRestored(db, guildId, userId, options = {}) {
    return db.transaction(() => {
        const existing = getLimitedAccount(db, guildId, userId);
        if (!existing) return null;
        if (existing.status === LIMITED_ACCOUNT_STATUS.RESTORED) return existing;

        const timestamp = options.restoredAt || now();
        db.prepare(`
            UPDATE honeypot_limited_accounts
            SET status = ?,
                restored_by = ?,
                restored_at = ?,
                restoration_source = ?,
                updated_at = ?
            WHERE guild_id = ? AND user_id = ?
        `).run(
            LIMITED_ACCOUNT_STATUS.RESTORED,
            options.restoredBy || null,
            timestamp,
            options.restorationSource || 'unknown',
            timestamp,
            guildId,
            userId,
        );
        return getLimitedAccount(db, guildId, userId);
    })();
}

function markLimitedAccountFailed(db, guildId, userId, options = {}) {
    const timestamp = options.updatedAt || now();
    db.prepare(`
        UPDATE honeypot_limited_accounts
        SET status = ?,
            restoration_source = ?,
            updated_at = ?
        WHERE guild_id = ? AND user_id = ?
    `).run(
        LIMITED_ACCOUNT_STATUS.FAILED,
        options.source || 'limit_failed',
        timestamp,
        guildId,
        userId,
    );
    return getLimitedAccount(db, guildId, userId);
}

module.exports = {
    LIMITED_ACCOUNT_STATUS,
    beginLimitedAccount,
    getLimitedAccount,
    listLimitedAccounts,
    mapLimitedAccount,
    markLimitedAccountFailed,
    markLimitedAccountRestored,
    upsertLimitedAccount,
};
