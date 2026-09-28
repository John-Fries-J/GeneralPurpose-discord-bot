function now() {
    return Date.now();
}

function stringify(value, fallback) {
    return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function makeId(prefix = '') {
    return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapCase(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        type: row.type,
        userId: row.user_id,
        userTag: row.user_tag,
        moderatorId: row.moderator_id,
        moderatorTag: row.moderator_tag,
        reason: row.reason,
        duration: row.duration,
        active: row.active !== 0,
        clearedAt: row.cleared_at,
        clearedBy: row.cleared_by,
        clearReason: row.clear_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

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

function mapTicket(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        openerId: row.opener_id,
        openerTag: row.opener_tag,
        claimedById: row.claimed_by_id,
        claimedByTag: row.claimed_by_tag,
        priority: row.priority,
        tags: parseJson(row.tags_json, []),
        status: row.status,
        closeReason: row.close_reason,
        closedAt: row.closed_at,
        lastActivityAt: row.last_activity_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapTranscript(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        ticketName: row.ticket_name,
        openerId: row.opener_id,
        createdBy: row.created_by,
        createdAt: row.created_at,
        messageCount: row.message_count,
        allowedUserIds: parseJson(row.allowed_user_ids_json, []),
        html: row.html,
        text: row.text,
    };
}

function mapScheduledMessage(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        content: row.content || '',
        embed: parseJson(row.embed_json, null),
        createdBy: row.created_by,
        createdAt: row.created_at,
        scheduledFor: row.scheduled_for,
        sentAt: row.sent_at,
        status: row.status,
        error: row.error,
    };
}

function mapReminder(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        userId: row.user_id,
        userTag: row.user_tag,
        message: row.message,
        remindAt: row.remind_at,
        deliveredAt: row.delivered_at,
        status: row.status,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function readState(db) {
    return {
        cases: db.prepare('SELECT * FROM moderation_cases ORDER BY id ASC').all().map(mapCase),
        commandStats: db.prepare('SELECT guild_id guildId, channel_id channelId, command, user_id userId, user_tag userTag, ok, error, created_at createdAt FROM command_usage ORDER BY created_at DESC LIMIT 10000').all().map(row => ({ ...row, ok: row.ok === 1 })),
        embedTemplates: listEmbedTemplates(db),
        history: db.prepare('SELECT * FROM user_history ORDER BY created_at DESC LIMIT 50000').all().map(mapHistory),
        levels: db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, text_xp textXp, voice_xp voiceXp, last_text_xp_at lastTextXpAt, updated_at updatedAt FROM levels').all(),
        modNotes: db.prepare('SELECT id, guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, moderator_tag moderatorTag, note, created_at createdAt FROM moderation_notes ORDER BY created_at DESC LIMIT 5000').all(),
        nextCaseId: (db.prepare("SELECT seq + 1 AS next FROM sqlite_sequence WHERE name = 'moderation_cases'").get()?.next) || 1,
        reactionRoles: db.prepare('SELECT guild_id guildId, message_id messageId, channel_id channelId, emoji, role_id roleId, created_at createdAt, updated_at updatedAt FROM reaction_roles').all(),
        scheduledMessages: listScheduledMessages(db, null, 1000),
        starboardMessages: db.prepare('SELECT guild_id guildId, message_id messageId, channel_id channelId, starboard_channel_id starboardChannelId, starboard_message_id starboardMessageId, count, created_at createdAt, updated_at updatedAt FROM starboard_messages').all(),
        tempBans: db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, reason, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_bans').all(),
        tempMutes: db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, reason, removed_role_ids removedRoleIds, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_mutes').all().map(row => ({ ...row, removedRoleIds: parseJson(row.removedRoleIds, []) })),
        tempRoles: db.prepare('SELECT guild_id guildId, user_id userId, role_id roleId, moderator_id moderatorId, reason, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_roles').all(),
        tempVoiceChannels: db.prepare('SELECT guild_id guildId, channel_id channelId, owner_id ownerId, trigger_channel_id triggerChannelId, name, locked, user_limit userLimit, last_occupied_at lastOccupiedAt, created_at createdAt, updated_at updatedAt FROM temporary_voice_channels').all().map(row => ({ ...row, locked: row.locked === 1 })),
        ticketTranscripts: listTicketTranscripts(db, null, 1000),
        ticketRecords: listTicketRecords(db, null, 1000),
        voiceActivity: listVoiceActivity(db, null, 5000),
        reminders: listReminders(db, null, 1000),
    };
}

function upsertTempBan(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO temporary_bans (guild_id, user_id, user_tag, moderator_id, reason, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            user_tag = excluded.user_tag,
            moderator_id = excluded.moderator_id,
            reason = excluded.reason,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.userId, record.userTag || null, record.moderatorId || null, record.reason || null, Number(record.expiresAt), record.createdAt || timestamp, timestamp);
}

function removeTempBan(db, guildId, userId) {
    db.prepare('DELETE FROM temporary_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function listExpiredTempBans(db, timestamp = now()) {
    return db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, reason, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_bans WHERE expires_at <= ? ORDER BY expires_at ASC').all(timestamp);
}

function upsertTempMute(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO temporary_mutes (guild_id, user_id, user_tag, moderator_id, reason, removed_role_ids, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            user_tag = excluded.user_tag,
            moderator_id = excluded.moderator_id,
            reason = excluded.reason,
            removed_role_ids = excluded.removed_role_ids,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.userId, record.userTag || null, record.moderatorId || null, record.reason || null, stringify(record.removedRoleIds, []), Number(record.expiresAt), record.createdAt || timestamp, timestamp);
}

function removeTempMute(db, guildId, userId) {
    db.prepare('DELETE FROM temporary_mutes WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function listExpiredTempMutes(db, timestamp = now()) {
    return db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, reason, removed_role_ids removedRoleIds, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_mutes WHERE expires_at <= ? ORDER BY expires_at ASC').all(timestamp)
        .map(row => ({ ...row, removedRoleIds: parseJson(row.removedRoleIds, []) }));
}

function getTempMute(db, guildId, userId) {
    const row = db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, reason, removed_role_ids removedRoleIds, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_mutes WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return row ? { ...row, removedRoleIds: parseJson(row.removedRoleIds, []) } : null;
}

function createModerationCase(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO moderation_cases (guild_id, type, user_id, user_tag, moderator_id, moderator_tag, reason, duration, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.guildId, record.type, record.userId, record.userTag || null, record.moderatorId || null, record.moderatorTag || null, record.reason || null, record.duration || null, record.active === false ? 0 : 1, timestamp, timestamp);
    return mapCase(db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND user_id = ? AND type = ? AND created_at = ? ORDER BY id DESC LIMIT 1').get(record.guildId, record.userId, record.type, timestamp));
}

function countActiveModerationCases(db, guildId, userId, type) {
    return db.prepare('SELECT COUNT(*) count FROM moderation_cases WHERE guild_id = ? AND user_id = ? AND type = ? AND active = 1').get(guildId, userId, type).count;
}

function getModerationCase(db, guildId, caseId) {
    return mapCase(db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND id = ?').get(guildId, Number(caseId)));
}

function listModerationCases(db, guildId, filters = {}) {
    const rows = filters.userId && filters.type
        ? db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND user_id = ? AND type = ? ORDER BY id DESC').all(guildId, filters.userId, filters.type)
        : filters.userId
            ? db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC').all(guildId, filters.userId)
            : filters.type
                ? db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND type = ? ORDER BY id DESC').all(guildId, filters.type)
                : db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? ORDER BY id DESC').all(guildId);
    return rows.map(mapCase);
}

function updateModerationCaseReason(db, guildId, caseId, reason) {
    db.prepare('UPDATE moderation_cases SET reason = ?, updated_at = ? WHERE guild_id = ? AND id = ?').run(reason, now(), guildId, Number(caseId));
    return getModerationCase(db, guildId, caseId);
}

function clearWarningCases(db, guildId, userId, moderatorId, reason) {
    const timestamp = now();
    return db.prepare(`
        UPDATE moderation_cases
        SET active = 0, cleared_at = ?, cleared_by = ?, clear_reason = ?, updated_at = ?
        WHERE guild_id = ? AND user_id = ? AND type = 'warn' AND active = 1
    `).run(timestamp, moderatorId, reason, timestamp, guildId, userId).changes;
}

function addUserHistory(db, record, maxEntries = 50000) {
    db.prepare(`
        INSERT INTO user_history (guild_id, user_id, user_tag, type, summary, channel_id, moderator_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.guildId, record.userId, record.userTag || null, record.type, record.summary, record.channelId || null, record.moderatorId || null, stringify(record.metadata, {}), record.createdAt || now());
    db.prepare('DELETE FROM user_history WHERE id NOT IN (SELECT id FROM user_history ORDER BY created_at DESC LIMIT ?)').run(maxEntries);
    return record;
}

function listUserHistory(db, guildId, userId, limit = 15) {
    return db.prepare('SELECT * FROM user_history WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, userId, limit).map(mapHistory);
}

function addModNote(db, record) {
    const timestamp = now();
    const note = {
        id: record.id || makeId(),
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        moderatorId: record.moderatorId,
        moderatorTag: record.moderatorTag,
        note: record.note,
        createdAt: record.createdAt || timestamp,
    };
    db.prepare(`
        INSERT INTO moderation_notes (id, guild_id, user_id, user_tag, moderator_id, moderator_tag, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(note.id, note.guildId, note.userId, note.userTag || null, note.moderatorId || null, note.moderatorTag || null, note.note, note.createdAt, timestamp);
    return note;
}

function listModNotes(db, guildId, userId, limit = 15) {
    return db.prepare('SELECT id, guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, moderator_tag moderatorTag, note, created_at createdAt FROM moderation_notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, userId, limit);
}

function deleteModNote(db, guildId, noteId) {
    const deleted = db.prepare('SELECT id, guild_id guildId, user_id userId, user_tag userTag, moderator_id moderatorId, moderator_tag moderatorTag, note, created_at createdAt FROM moderation_notes WHERE guild_id = ? AND id = ?').get(guildId, noteId) || null;
    db.prepare('DELETE FROM moderation_notes WHERE guild_id = ? AND id = ?').run(guildId, noteId);
    return deleted;
}

function recordCommandUsage(db, record) {
    db.prepare(`
        INSERT INTO command_usage (guild_id, channel_id, command, user_id, user_tag, ok, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.guildId || null, record.channelId || null, record.command, record.userId, record.userTag || null, record.ok === true ? 1 : 0, record.error || null, now());
    db.prepare('DELETE FROM command_usage WHERE id NOT IN (SELECT id FROM command_usage ORDER BY created_at DESC LIMIT 10000)').run();
}

function listCommandStats(db, guildId, since = 0) {
    const rows = guildId
        ? db.prepare('SELECT guild_id guildId, channel_id channelId, command, user_id userId, user_tag userTag, ok, error, created_at createdAt FROM command_usage WHERE guild_id = ? AND created_at >= ? ORDER BY created_at DESC').all(guildId, since || 0)
        : db.prepare('SELECT guild_id guildId, channel_id channelId, command, user_id userId, user_tag userTag, ok, error, created_at createdAt FROM command_usage WHERE created_at >= ? ORDER BY created_at DESC').all(since || 0);
    return rows.map(row => ({ ...row, ok: row.ok === 1 }));
}

function upsertTempVoiceChannel(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO temporary_voice_channels (channel_id, guild_id, owner_id, trigger_channel_id, name, locked, user_limit, last_occupied_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
            guild_id = excluded.guild_id,
            owner_id = excluded.owner_id,
            trigger_channel_id = excluded.trigger_channel_id,
            name = excluded.name,
            locked = excluded.locked,
            user_limit = excluded.user_limit,
            last_occupied_at = excluded.last_occupied_at,
            updated_at = excluded.updated_at
    `).run(record.channelId, record.guildId, record.ownerId, record.triggerChannelId || null, record.name || null, record.locked ? 1 : 0, Number(record.userLimit || 0), record.lastOccupiedAt || null, record.createdAt || timestamp, timestamp);
}

function removeTempVoiceChannel(db, channelId) {
    db.prepare('DELETE FROM temporary_voice_channels WHERE channel_id = ?').run(channelId);
}

function getTempVoiceChannel(db, channelId) {
    const row = db.prepare('SELECT guild_id guildId, channel_id channelId, owner_id ownerId, trigger_channel_id triggerChannelId, name, locked, user_limit userLimit, last_occupied_at lastOccupiedAt, created_at createdAt, updated_at updatedAt FROM temporary_voice_channels WHERE channel_id = ?').get(channelId);
    return row ? { ...row, locked: row.locked === 1 } : null;
}

function listTempVoiceChannelsForGuild(db, guildId) {
    return db.prepare('SELECT guild_id guildId, channel_id channelId, owner_id ownerId, trigger_channel_id triggerChannelId, name, locked, user_limit userLimit, last_occupied_at lastOccupiedAt, created_at createdAt, updated_at updatedAt FROM temporary_voice_channels WHERE guild_id = ? ORDER BY created_at ASC').all(guildId).map(row => ({ ...row, locked: row.locked === 1 }));
}

function upsertTempRole(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO temporary_roles (guild_id, user_id, role_id, moderator_id, reason, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET
            moderator_id = excluded.moderator_id,
            reason = excluded.reason,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.userId, record.roleId, record.moderatorId || null, record.reason || null, Number(record.expiresAt), record.createdAt || timestamp, timestamp);
}

function removeTempRole(db, guildId, userId, roleId) {
    db.prepare('DELETE FROM temporary_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?').run(guildId, userId, roleId);
}

function listExpiredTempRoles(db, timestamp = now()) {
    return db.prepare('SELECT guild_id guildId, user_id userId, role_id roleId, moderator_id moderatorId, reason, expires_at expiresAt, created_at createdAt, updated_at updatedAt FROM temporary_roles WHERE expires_at <= ? ORDER BY expires_at ASC').all(timestamp);
}

function appendVoiceActivity(db, record) {
    const entry = {
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        oldChannelId: record.oldChannelId || null,
        newChannelId: record.newChannelId || null,
        type: record.type,
        createdAt: now(),
    };
    db.prepare(`
        INSERT INTO voice_activity (guild_id, user_id, user_tag, old_channel_id, new_channel_id, type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.guildId, entry.userId, entry.userTag || null, entry.oldChannelId, entry.newChannelId, entry.type, entry.createdAt);
    db.prepare('DELETE FROM voice_activity WHERE id NOT IN (SELECT id FROM voice_activity ORDER BY created_at DESC LIMIT 5000)').run();
    return entry;
}

function listVoiceActivity(db, guildId, limit = 50) {
    const rows = guildId
        ? db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, old_channel_id oldChannelId, new_channel_id newChannelId, type, created_at createdAt FROM voice_activity WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit)
        : db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, old_channel_id oldChannelId, new_channel_id newChannelId, type, created_at createdAt FROM voice_activity ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows;
}

function getStarboardMessage(db, guildId, messageId) {
    return db.prepare('SELECT guild_id guildId, message_id messageId, channel_id channelId, starboard_channel_id starboardChannelId, starboard_message_id starboardMessageId, count, created_at createdAt, updated_at updatedAt FROM starboard_messages WHERE guild_id = ? AND message_id = ?').get(guildId, messageId) || null;
}

function upsertStarboardMessage(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO starboard_messages (guild_id, message_id, channel_id, starboard_channel_id, starboard_message_id, count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, message_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            starboard_channel_id = excluded.starboard_channel_id,
            starboard_message_id = excluded.starboard_message_id,
            count = excluded.count,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.messageId, record.channelId, record.starboardChannelId, record.starboardMessageId, Number(record.count || 0), record.createdAt || timestamp, timestamp);
}

function addUserXp(db, guildId, userId, userTag, type, amount, cooldownMs = 0) {
    const timestamp = now();
    let record = getUserLevelRecord(db, guildId, userId);
    if (!record) {
        record = { guildId, userId, userTag, textXp: 0, voiceXp: 0, lastTextXpAt: 0, createdAt: timestamp, updatedAt: timestamp };
    }
    if (type === 'text' && cooldownMs && timestamp - Number(record.lastTextXpAt || 0) < cooldownMs) return record;
    if (type === 'text') {
        record.textXp = Number(record.textXp || 0) + amount;
        record.lastTextXpAt = timestamp;
    } else {
        record.voiceXp = Number(record.voiceXp || 0) + amount;
    }
    record.userTag = userTag;
    db.prepare(`
        INSERT INTO levels (guild_id, user_id, user_tag, text_xp, voice_xp, last_text_xp_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            user_tag = excluded.user_tag,
            text_xp = excluded.text_xp,
            voice_xp = excluded.voice_xp,
            last_text_xp_at = excluded.last_text_xp_at,
            updated_at = excluded.updated_at
    `).run(guildId, userId, userTag || null, record.textXp, record.voiceXp, record.lastTextXpAt || 0, record.createdAt || timestamp, timestamp);
    return getUserLevelRecord(db, guildId, userId);
}

function getUserLevelRecord(db, guildId, userId) {
    return db.prepare('SELECT guild_id guildId, user_id userId, user_tag userTag, text_xp textXp, voice_xp voiceXp, last_text_xp_at lastTextXpAt, created_at createdAt, updated_at updatedAt FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || null;
}

function listLevelLeaderboard(db, guildId, limit = 10, mode = 'total') {
    const order = mode === 'text' ? 'text_xp' : (mode === 'voice' ? 'voice_xp' : '(text_xp + voice_xp)');
    return db.prepare(`SELECT guild_id guildId, user_id userId, user_tag userTag, text_xp textXp, voice_xp voiceXp, last_text_xp_at lastTextXpAt, created_at createdAt, updated_at updatedAt FROM levels WHERE guild_id = ? AND ${order} > 0 ORDER BY ${order} DESC LIMIT ?`).all(guildId, limit);
}

function createScheduledMessage(db, record) {
    const timestamp = now();
    const entry = {
        id: record.id || makeId(),
        guildId: record.guildId,
        channelId: record.channelId,
        content: record.content || '',
        embed: record.embed || null,
        createdBy: record.createdBy || null,
        createdAt: record.createdAt || timestamp,
        scheduledFor: Number(record.scheduledFor),
        sentAt: record.sentAt || null,
        status: record.status || 'pending',
        error: record.error || null,
    };
    db.prepare(`
        INSERT INTO scheduled_messages (id, guild_id, channel_id, content, embed_json, created_by, scheduled_for, sent_at, status, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.guildId, entry.channelId, entry.content, stringify(entry.embed, null), entry.createdBy, entry.scheduledFor, entry.sentAt, entry.status, entry.error, entry.createdAt, timestamp);
    return entry;
}

function listScheduledMessages(db, guildId, limit = 50) {
    const rows = guildId
        ? db.prepare('SELECT * FROM scheduled_messages WHERE guild_id = ? ORDER BY scheduled_for ASC LIMIT ?').all(guildId, limit)
        : db.prepare('SELECT * FROM scheduled_messages ORDER BY scheduled_for ASC LIMIT ?').all(limit);
    return rows.map(mapScheduledMessage);
}

function listDueScheduledMessages(db, timestamp = now(), limit = 25) {
    return db.prepare("SELECT * FROM scheduled_messages WHERE status = 'pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT ?").all(timestamp, limit).map(mapScheduledMessage);
}

function updateScheduledMessageStatus(db, id, status, error = null) {
    db.prepare("UPDATE scheduled_messages SET status = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?").run(status, error, status, now(), now(), id);
    return mapScheduledMessage(db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id));
}

function deleteScheduledMessage(db, id) {
    const deleted = mapScheduledMessage(db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id));
    db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
    return deleted;
}

function upsertEmbedTemplate(db, record) {
    const timestamp = now();
    const template = {
        id: record.id || makeId(),
        guildId: record.guildId,
        name: record.name,
        content: record.content || '',
        embed: record.embed || null,
        updatedBy: record.updatedBy || null,
        createdAt: record.createdAt || timestamp,
        updatedAt: timestamp,
    };
    db.prepare(`
        INSERT INTO embed_templates (id, guild_id, name, content, embed_json, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            content = excluded.content,
            embed_json = excluded.embed_json,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
    `).run(template.id, template.guildId, template.name, template.content, stringify(template.embed, null), template.updatedBy, template.createdAt, template.updatedAt);
    return template;
}

function listEmbedTemplates(db, guildId = null) {
    const rows = guildId
        ? db.prepare('SELECT id, guild_id guildId, name, content, embed_json embedJson, updated_by updatedBy, created_at createdAt, updated_at updatedAt FROM embed_templates WHERE guild_id = ? ORDER BY name ASC').all(guildId)
        : db.prepare('SELECT id, guild_id guildId, name, content, embed_json embedJson, updated_by updatedBy, created_at createdAt, updated_at updatedAt FROM embed_templates ORDER BY name ASC').all();
    return rows.map(row => ({ ...row, embed: parseJson(row.embedJson, null), embedJson: undefined }));
}

function deleteEmbedTemplate(db, guildId, id) {
    const deleted = listEmbedTemplates(db, guildId).find(item => item.id === id) || null;
    db.prepare('DELETE FROM embed_templates WHERE guild_id = ? AND id = ?').run(guildId, id);
    return deleted;
}

function upsertTicketRecord(db, record) {
    const timestamp = now();
    const existing = getTicketRecord(db, record.channelId);
    const ticket = {
        id: record.id || existing?.id || record.channelId,
        guildId: record.guildId || existing?.guildId,
        channelId: record.channelId,
        openerId: record.openerId || existing?.openerId || null,
        openerTag: record.openerTag || existing?.openerTag || null,
        claimedById: record.claimedById !== undefined ? record.claimedById : existing?.claimedById || null,
        claimedByTag: record.claimedByTag !== undefined ? record.claimedByTag : existing?.claimedByTag || null,
        priority: record.priority || existing?.priority || 'normal',
        tags: record.tags || existing?.tags || [],
        status: record.status || existing?.status || 'open',
        closeReason: record.closeReason || existing?.closeReason || null,
        closedAt: record.closedAt || existing?.closedAt || null,
        lastActivityAt: record.lastActivityAt || existing?.lastActivityAt || timestamp,
        createdAt: existing?.createdAt || record.createdAt || timestamp,
    };
    db.prepare(`
        INSERT INTO tickets (id, guild_id, channel_id, opener_id, opener_tag, claimed_by_id, claimed_by_tag, priority, tags_json, status, close_reason, closed_at, last_activity_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
            opener_id = excluded.opener_id,
            opener_tag = excluded.opener_tag,
            claimed_by_id = excluded.claimed_by_id,
            claimed_by_tag = excluded.claimed_by_tag,
            priority = excluded.priority,
            tags_json = excluded.tags_json,
            status = excluded.status,
            close_reason = excluded.close_reason,
            closed_at = excluded.closed_at,
            last_activity_at = excluded.last_activity_at,
            updated_at = excluded.updated_at
    `).run(ticket.id, ticket.guildId, ticket.channelId, ticket.openerId, ticket.openerTag, ticket.claimedById, ticket.claimedByTag, ticket.priority, stringify(ticket.tags, []), ticket.status, ticket.closeReason, ticket.closedAt, ticket.lastActivityAt, ticket.createdAt, timestamp);
    return getTicketRecord(db, ticket.channelId);
}

function getTicketRecord(db, channelId) {
    return mapTicket(db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId));
}

function listTicketRecords(db, guildId, limit = 100) {
    const rows = guildId
        ? db.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY updated_at DESC LIMIT ?').all(guildId, limit)
        : db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC LIMIT ?').all(limit);
    return rows.map(mapTicket);
}

function deleteTicketRecord(db, channelId) {
    db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(channelId);
}

function createTicketTranscript(db, record) {
    const timestamp = now();
    const transcript = {
        id: record.id || makeId(),
        guildId: record.guildId,
        channelId: record.channelId,
        channelName: record.channelName || record.channelId,
        ticketName: record.ticketName || record.channelName || record.channelId,
        openerId: record.openerId || null,
        createdBy: record.createdBy || null,
        createdAt: record.createdAt || timestamp,
        messageCount: Number(record.messageCount || 0),
        allowedUserIds: [...new Set((record.allowedUserIds || []).filter(Boolean))],
        html: record.html || '',
        text: record.text || '',
    };
    db.prepare(`
        INSERT INTO ticket_transcripts (id, guild_id, channel_id, channel_name, ticket_name, opener_id, created_by, message_count, allowed_user_ids_json, html, text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(transcript.id, transcript.guildId, transcript.channelId, transcript.channelName, transcript.ticketName, transcript.openerId, transcript.createdBy, transcript.messageCount, stringify(transcript.allowedUserIds, []), transcript.html, transcript.text, transcript.createdAt, timestamp);
    return transcript;
}

function getTicketTranscript(db, id) {
    return mapTranscript(db.prepare('SELECT * FROM ticket_transcripts WHERE id = ?').get(id));
}

function listTicketTranscripts(db, guildId, limit = 50) {
    const rows = guildId
        ? db.prepare('SELECT * FROM ticket_transcripts WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit)
        : db.prepare('SELECT * FROM ticket_transcripts ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(mapTranscript);
}

function createReminder(db, record) {
    const timestamp = now();
    const reminder = {
        id: record.id || makeId(),
        guildId: record.guildId || null,
        channelId: record.channelId || null,
        userId: record.userId,
        userTag: record.userTag || null,
        message: record.message,
        remindAt: Number(record.remindAt),
        deliveredAt: record.deliveredAt || null,
        status: record.status || 'pending',
        error: record.error || null,
        createdAt: record.createdAt || timestamp,
        updatedAt: timestamp,
    };
    db.prepare(`
        INSERT INTO reminders (id, guild_id, channel_id, user_id, user_tag, message, remind_at, delivered_at, status, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reminder.id, reminder.guildId, reminder.channelId, reminder.userId, reminder.userTag, reminder.message, reminder.remindAt, reminder.deliveredAt, reminder.status, reminder.error, reminder.createdAt, reminder.updatedAt);
    return reminder;
}

function listDueReminders(db, timestamp = now(), limit = 25) {
    return db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at ASC LIMIT ?").all(timestamp, limit).map(mapReminder);
}

function listReminders(db, userId = null, limit = 50) {
    const rows = userId
        ? db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at DESC LIMIT ?').all(userId, limit)
        : db.prepare('SELECT * FROM reminders ORDER BY remind_at DESC LIMIT ?').all(limit);
    return rows.map(mapReminder);
}

function updateReminderStatus(db, id, status, error = null) {
    db.prepare("UPDATE reminders SET status = ?, error = ?, delivered_at = CASE WHEN ? = 'sent' THEN ? ELSE delivered_at END, updated_at = ? WHERE id = ?").run(status, error, status, now(), now(), id);
    return mapReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
}

function markScheduledJobStart(db, name) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO scheduled_jobs (name, running_since, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            running_since = excluded.running_since,
            updated_at = excluded.updated_at
    `).run(name, timestamp, timestamp);
}

function markScheduledJobFinish(db, name, durationMs, error = null) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO scheduled_jobs (name, last_run_at, last_duration_ms, last_error, running_since, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(name) DO UPDATE SET
            last_run_at = excluded.last_run_at,
            last_duration_ms = excluded.last_duration_ms,
            last_error = excluded.last_error,
            running_since = NULL,
            updated_at = excluded.updated_at
    `).run(name, timestamp, durationMs, error, timestamp);
}

function listScheduledJobStatus(db) {
    return db.prepare('SELECT name, last_run_at lastRunAt, last_duration_ms lastDurationMs, last_error lastError, running_since runningSince, updated_at updatedAt FROM scheduled_jobs ORDER BY name ASC').all();
}

function importState(db, state = {}) {
    const counts = {};
    const count = (name, records, fn) => {
        counts[name] = 0;
        for (const record of records || []) {
            fn(record);
            counts[name] += 1;
        }
    };

    count('tempBans', state.tempBans, record => upsertTempBan(db, record));
    count('tempMutes', state.tempMutes, record => upsertTempMute(db, record));
    count('tempRoles', state.tempRoles, record => upsertTempRole(db, record));
    count('cases', state.cases, record => {
        const created = createModerationCase(db, record);
        if (record.id && created.id !== record.id) {
            db.prepare('UPDATE moderation_cases SET id = ? WHERE id = ?').run(record.id, created.id);
        }
    });
    count('history', state.history, record => addUserHistory(db, record));
    count('modNotes', state.modNotes, record => addModNote(db, record));
    count('commandStats', state.commandStats, record => recordCommandUsage(db, record));
    count('tempVoiceChannels', state.tempVoiceChannels, record => upsertTempVoiceChannel(db, record));
    count('voiceActivity', state.voiceActivity, record => appendVoiceActivity(db, record));
    count('starboardMessages', state.starboardMessages, record => upsertStarboardMessage(db, record));
    count('levels', state.levels, record => {
        db.prepare(`
            INSERT INTO levels (guild_id, user_id, user_tag, text_xp, voice_xp, last_text_xp_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                user_tag = excluded.user_tag,
                text_xp = excluded.text_xp,
                voice_xp = excluded.voice_xp,
                last_text_xp_at = excluded.last_text_xp_at,
                updated_at = excluded.updated_at
        `).run(record.guildId, record.userId, record.userTag || null, Number(record.textXp || 0), Number(record.voiceXp || 0), Number(record.lastTextXpAt || 0), record.createdAt || now(), record.updatedAt || now());
    });
    count('scheduledMessages', state.scheduledMessages, record => createScheduledMessage(db, record));
    count('embedTemplates', state.embedTemplates, record => upsertEmbedTemplate(db, record));
    count('ticketRecords', state.ticketRecords, record => upsertTicketRecord(db, record));
    count('ticketTranscripts', state.ticketTranscripts, record => createTicketTranscript(db, record));
    count('reminders', state.reminders, record => createReminder(db, record));

    return counts;
}

module.exports = {
    addModNote,
    addUserHistory,
    addUserXp,
    appendVoiceActivity,
    clearWarningCases,
    countActiveModerationCases,
    createModerationCase,
    createReminder,
    createScheduledMessage,
    createTicketTranscript,
    deleteEmbedTemplate,
    deleteModNote,
    deleteScheduledMessage,
    deleteTicketRecord,
    getModerationCase,
    getStarboardMessage,
    getTempMute,
    getTempVoiceChannel,
    getTicketRecord,
    getTicketTranscript,
    getUserLevelRecord,
    importState,
    listCommandStats,
    listDueReminders,
    listDueScheduledMessages,
    listEmbedTemplates,
    listExpiredTempBans,
    listExpiredTempMutes,
    listExpiredTempRoles,
    listLevelLeaderboard,
    listModNotes,
    listReminders,
    listScheduledJobStatus,
    listScheduledMessages,
    listTempVoiceChannelsForGuild,
    listTicketRecords,
    listTicketTranscripts,
    listUserHistory,
    listModerationCases,
    listVoiceActivity,
    readState,
    recordCommandUsage,
    removeTempBan,
    removeTempMute,
    removeTempRole,
    removeTempVoiceChannel,
    updateModerationCaseReason,
    updateReminderStatus,
    markScheduledJobFinish,
    markScheduledJobStart,
    updateScheduledMessageStatus,
    upsertEmbedTemplate,
    upsertStarboardMessage,
    upsertTempBan,
    upsertTempMute,
    upsertTempRole,
    upsertTempVoiceChannel,
    upsertTicketRecord,
};
