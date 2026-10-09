const { makeId } = require('./ids');
const historyRepository = require('./historyRepository');
const honeypotLimitedAccountsRepository = require('./honeypotLimitedAccountsRepository');
const { now, parseJson, pruneTableByNewest, stringify } = require('./shared');

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

function mapGuildSetting(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        section: row.section,
        key: row.setting_key,
        value: parseJson(row.value_json, null),
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapGuildLogChannel(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        key: row.log_key,
        channelId: row.channel_id,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapGuildLevelReward(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        roleId: row.role_id,
        xp: row.xp,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapConfigAudit(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        actorId: row.actor_id,
        section: row.section,
        key: row.setting_key,
        previousValue: row.previous_value,
        newValue: row.new_value,
        source: row.source,
        createdAt: row.created_at,
    };
}

function mapLevelXpEvent(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        userTag: row.user_tag,
        source: row.source,
        sourceKey: row.source_key,
        xpType: row.xp_type,
        amount: row.amount,
        previousTextXp: row.previous_text_xp,
        previousVoiceXp: row.previous_voice_xp,
        newTextXp: row.new_text_xp,
        newVoiceXp: row.new_voice_xp,
        adminId: row.admin_id,
        jobId: row.job_id,
        metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at,
    };
}

function mapLevelImportJob(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        targetUserId: row.target_user_id,
        status: row.status,
        dryRun: row.dry_run !== 0,
        profileHash: row.profile_hash,
        profile: parseJson(row.profile_json, {}),
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        currentChannelId: row.current_channel_id,
        channelsTotal: row.channels_total,
        channelsScanned: row.channels_scanned,
        messagesSeen: row.messages_seen,
        messagesEligible: row.messages_eligible,
        membersSeen: row.members_seen,
        xpEstimated: row.xp_estimated,
        xpApplied: row.xp_applied,
        skippedChannels: parseJson(row.skipped_channels_json, []),
        errors: parseJson(row.errors_json, []),
        cancelRequested: row.cancel_requested !== 0,
        provenance: parseJson(row.provenance_json, {}),
        result: parseJson(row.result_json, {}),
    };
}

function mapLevelImportCheckpoint(row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        parentChannelId: row.parent_channel_id,
        beforeMessageId: row.before_message_id,
        oldestMessageId: row.oldest_message_id,
        status: row.status,
        messagesSeen: row.messages_seen,
        messagesEligible: row.messages_eligible,
        error: row.error,
        updatedAt: row.updated_at,
    };
}

function mapLevelImportMessage(row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        guildId: row.guild_id,
        messageId: row.message_id,
        userId: row.user_id,
        userTag: row.user_tag,
        channelId: row.channel_id,
        createdAt: row.created_at,
        xpAmount: row.xp_amount,
        eligible: row.eligible !== 0,
        skipReason: row.skip_reason,
    };
}

function mapLevelCalibrationJob(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        importJobId: row.import_job_id,
        kind: row.kind,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        profile: parseJson(row.profile_json, {}),
        options: parseJson(row.options_json, {}),
        progress: parseJson(row.progress_json, {}),
        result: parseJson(row.result_json, {}),
        error: row.error,
        cancelRequested: row.cancel_requested !== 0,
    };
}

function mapLevelProbotScanJob(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        sourceChannelId: row.source_channel_id,
        sourceChannelIds: parseJson(row.source_channel_ids_json, []),
        probotAuthorId: row.probot_author_id,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        currentChannelId: row.current_channel_id,
        channelsTotal: row.channels_total,
        channelsScanned: row.channels_scanned,
        scannedCount: row.scanned_count,
        matchedCount: row.matched_count,
        verifiedCount: row.verified_count,
        unresolvedCount: row.unresolved_count,
        invalidCount: row.invalid_count,
        skippedCount: row.skipped_count,
        duplicateCount: row.duplicate_count,
        oldestScannedAt: row.oldest_scanned_at,
        newestScannedAt: row.newest_scanned_at,
        errors: parseJson(row.errors_json, []),
        cancelRequested: row.cancel_requested !== 0,
        result: parseJson(row.result_json, {}),
    };
}

function mapLevelProbotScanCheckpoint(row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        parentChannelId: row.parent_channel_id,
        beforeMessageId: row.before_message_id,
        oldestMessageId: row.oldest_message_id,
        status: row.status,
        scannedCount: row.scanned_count,
        matchedCount: row.matched_count,
        verifiedCount: row.verified_count,
        unresolvedCount: row.unresolved_count,
        invalidCount: row.invalid_count,
        skippedCount: row.skipped_count,
        duplicateCount: row.duplicate_count,
        oldestScannedAt: row.oldest_scanned_at,
        newestScannedAt: row.newest_scanned_at,
        error: row.error,
        updatedAt: row.updated_at,
    };
}

function mapLevelProbotAnnouncement(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        sourceChannelId: row.source_channel_id,
        messageId: row.message_id,
        jobId: row.job_id,
        probotAuthorId: row.probot_author_id,
        targetUserId: row.target_user_id,
        announcedLevel: row.announced_level,
        announcementTimestamp: row.announcement_timestamp,
        parserVersion: row.parser_version,
        parseStatus: row.parse_status,
        confidence: row.confidence,
        contentSource: row.content_source,
        diagnostic: parseJson(row.diagnostic_json, {}),
        createdAt: row.created_at,
    };
}

function mapLevelRoleMapping(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        roleId: row.role_id,
        minimumLevel: row.minimum_level,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapLevelReconciliation(row) {
    if (!row) return null;
    return {
        id: row.id,
        jobId: row.job_id,
        guildId: row.guild_id,
        userId: row.user_id,
        userTag: row.user_tag,
        existingXp: row.existing_xp,
        messageEstimatedXp: row.message_estimated_xp,
        messageEstimatedLevel: row.message_estimated_level,
        roleMinLevel: row.role_min_level,
        roleMinXp: row.role_min_xp,
        finalXp: row.final_xp,
        policy: row.policy,
        dryRun: row.dry_run !== 0,
        applied: row.applied !== 0,
        metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at,
    };
}

function mapLevelTestSession(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        userTag: row.user_tag,
        adminId: row.admin_id,
        status: row.status,
        previewOnly: row.preview_only !== 0,
        previousTextXp: row.previous_text_xp,
        previousVoiceXp: row.previous_voice_xp,
        xpDelta: row.xp_delta,
        xpType: row.xp_type,
        managedRoleIds: parseJson(row.managed_role_ids_json, []),
        addedRoleIds: parseJson(row.added_role_ids_json, []),
        removedRoleIds: parseJson(row.removed_role_ids_json, []),
        metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        rolledBackAt: row.rolled_back_at,
    };
}

function readState(db) {
    return {
        cases: db.prepare('SELECT * FROM moderation_cases ORDER BY id ASC').all().map(mapCase),
        commandStats: historyRepository.listCommandStats(db, null, 0, 10000),
        embedTemplates: listEmbedTemplates(db),
        history: historyRepository.listRecentUserHistory(db, 50000),
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
        guildSettings: listAllGuildSettings(db),
        guildLogChannels: listAllGuildLogChannels(db),
        guildLevelRewards: listAllGuildLevelRewards(db),
        configAudit: listConfigAudit(db, null, { limit: 1000 }),
        limitedAccounts: honeypotLimitedAccountsRepository.listLimitedAccounts(db),
        levelXpEvents: listLevelXpEvents(db, null, { limit: 1000 }),
        levelImportJobs: listLevelImportJobs(db, null, { limit: 1000 }),
        levelImportCheckpoints: listLevelImportCheckpoints(db),
        levelImportMessages: listLevelImportMessages(db, null, { limit: 1000 }),
        levelCalibrationJobs: listLevelCalibrationJobs(db, null, { limit: 1000 }),
        levelProbotScanJobs: listLevelProbotScanJobs(db, null, { limit: 1000 }),
        levelProbotScanCheckpoints: listLevelProbotScanCheckpoints(db),
        levelProbotAnnouncements: db.prepare('SELECT * FROM level_probot_announcements ORDER BY announcement_timestamp DESC LIMIT 1000').all().map(mapLevelProbotAnnouncement),
        levelProcessedMessages: listLevelProcessedMessages(db, null, { limit: 1000 }),
        levelRoleMappings: listLevelRoleMappings(db),
        levelReconciliationRecords: listLevelReconciliationRecords(db, null, { limit: 1000 }),
        levelTestSessions: listLevelTestSessions(db, null, { limit: 1000 }),
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

const {
    addUserHistory,
    listCommandStats,
    listGuildHistory,
    listUserHistory,
    recordCommandUsage,
} = historyRepository;

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

function appendVoiceActivity(db, record, maxEntries = 5000) {
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
    pruneTableByNewest(db, 'voice_activity', maxEntries);
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

function listLevelLeaderboard(db, guildId, limit = 10, mode = 'total', offset = 0) {
    const order = mode === 'text' ? 'text_xp' : (mode === 'voice' ? 'voice_xp' : '(text_xp + voice_xp)');
    const safeOffset = Math.max(0, Number(offset || 0));
    return db.prepare(`SELECT guild_id guildId, user_id userId, user_tag userTag, text_xp textXp, voice_xp voiceXp, last_text_xp_at lastTextXpAt, created_at createdAt, updated_at updatedAt FROM levels WHERE guild_id = ? AND ${order} > 0 ORDER BY ${order} DESC, user_id ASC LIMIT ? OFFSET ?`).all(guildId, limit, safeOffset);
}

function getLevelScoreExpression(mode = 'total') {
    if (mode === 'text') return 'text_xp';
    if (mode === 'voice') return 'voice_xp';
    return '(text_xp + voice_xp)';
}

function getLevelRank(db, guildId, userId, mode = 'total') {
    const record = getUserLevelRecord(db, guildId, userId);
    if (!record) return null;
    const score = mode === 'text'
        ? Number(record.textXp || 0)
        : (mode === 'voice' ? Number(record.voiceXp || 0) : Number(record.textXp || 0) + Number(record.voiceXp || 0));
    if (score <= 0) return null;

    const expression = getLevelScoreExpression(mode);
    const row = db.prepare(`SELECT COUNT(*) + 1 AS rank FROM levels WHERE guild_id = ? AND (${expression} > ? OR (${expression} = ? AND user_id < ?))`)
        .get(guildId, score, score, userId);
    return row?.rank || null;
}

function upsertLevelRecord(db, record) {
    const timestamp = now();
    const existing = getUserLevelRecord(db, record.guildId, record.userId);
    const createdAt = record.createdAt || existing?.createdAt || timestamp;
    db.prepare(`
        INSERT INTO levels (guild_id, user_id, user_tag, text_xp, voice_xp, last_text_xp_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            user_tag = excluded.user_tag,
            text_xp = excluded.text_xp,
            voice_xp = excluded.voice_xp,
            last_text_xp_at = excluded.last_text_xp_at,
            updated_at = excluded.updated_at
    `).run(
        record.guildId,
        record.userId,
        record.userTag || existing?.userTag || null,
        Math.max(0, Math.floor(Number(record.textXp || 0))),
        Math.max(0, Math.floor(Number(record.voiceXp || 0))),
        Number(record.lastTextXpAt ?? existing?.lastTextXpAt ?? 0),
        createdAt,
        record.updatedAt || timestamp,
    );
    return getUserLevelRecord(db, record.guildId, record.userId);
}

function insertLevelXpEvent(db, event) {
    const timestamp = event.createdAt || now();
    const result = db.prepare(`
        INSERT OR IGNORE INTO level_xp_events (
            guild_id, user_id, user_tag, source, source_key, xp_type, amount,
            previous_text_xp, previous_voice_xp, new_text_xp, new_voice_xp,
            admin_id, job_id, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        event.guildId,
        event.userId,
        event.userTag || null,
        event.source,
        event.sourceKey || null,
        event.xpType || 'text',
        Number(event.amount || 0),
        Number(event.previousTextXp || 0),
        Number(event.previousVoiceXp || 0),
        Number(event.newTextXp || 0),
        Number(event.newVoiceXp || 0),
        event.adminId || null,
        event.jobId || null,
        stringify(event.metadata, {}),
        timestamp,
    );
    if (!result.changes && event.sourceKey) return null;
    return mapLevelXpEvent(db.prepare('SELECT * FROM level_xp_events WHERE id = ?').get(result.lastInsertRowid));
}

function adjustUserXp(db, record) {
    return db.transaction(() => {
        const timestamp = record.createdAt || now();
        const previous = getUserLevelRecord(db, record.guildId, record.userId) || {
            guildId: record.guildId,
            userId: record.userId,
            userTag: record.userTag || null,
            textXp: 0,
            voiceXp: 0,
            lastTextXpAt: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const amount = Math.trunc(Number(record.amount || 0));
        const xpType = record.xpType === 'voice' ? 'voice' : 'text';
        const next = {
            ...previous,
            userTag: record.userTag || previous.userTag || null,
            textXp: Math.max(0, Number(previous.textXp || 0) + (xpType === 'text' ? amount : 0)),
            voiceXp: Math.max(0, Number(previous.voiceXp || 0) + (xpType === 'voice' ? amount : 0)),
            lastTextXpAt: record.lastTextXpAt ?? previous.lastTextXpAt ?? 0,
            updatedAt: timestamp,
        };

        const updated = upsertLevelRecord(db, next);
        insertLevelXpEvent(db, {
            guildId: record.guildId,
            userId: record.userId,
            userTag: record.userTag || previous.userTag || null,
            source: record.source || 'adjustment',
            sourceKey: record.sourceKey || null,
            xpType,
            amount,
            previousTextXp: previous.textXp,
            previousVoiceXp: previous.voiceXp,
            newTextXp: updated.textXp,
            newVoiceXp: updated.voiceXp,
            adminId: record.adminId || null,
            jobId: record.jobId || null,
            metadata: record.metadata || {},
            createdAt: timestamp,
        });
        return updated;
    })();
}

function setUserXp(db, record) {
    return db.transaction(() => {
        const timestamp = record.createdAt || now();
        const previous = getUserLevelRecord(db, record.guildId, record.userId) || {
            guildId: record.guildId,
            userId: record.userId,
            userTag: record.userTag || null,
            textXp: 0,
            voiceXp: 0,
            lastTextXpAt: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const next = {
            ...previous,
            userTag: record.userTag || previous.userTag || null,
            textXp: Math.max(0, Math.floor(Number(record.textXp ?? previous.textXp ?? 0))),
            voiceXp: Math.max(0, Math.floor(Number(record.voiceXp ?? previous.voiceXp ?? 0))),
            lastTextXpAt: record.lastTextXpAt ?? previous.lastTextXpAt ?? 0,
            updatedAt: timestamp,
        };
        const updated = upsertLevelRecord(db, next);
        insertLevelXpEvent(db, {
            guildId: record.guildId,
            userId: record.userId,
            userTag: record.userTag || previous.userTag || null,
            source: record.source || 'set',
            sourceKey: record.sourceKey || null,
            xpType: record.xpType || 'combined',
            amount: (Number(updated.textXp || 0) + Number(updated.voiceXp || 0)) - (Number(previous.textXp || 0) + Number(previous.voiceXp || 0)),
            previousTextXp: previous.textXp,
            previousVoiceXp: previous.voiceXp,
            newTextXp: updated.textXp,
            newVoiceXp: updated.voiceXp,
            adminId: record.adminId || null,
            jobId: record.jobId || null,
            metadata: record.metadata || {},
            createdAt: timestamp,
        });
        return updated;
    })();
}

function setUserXpMinimum(db, record) {
    const previous = getUserLevelRecord(db, record.guildId, record.userId);
    const currentTotal = Number(previous?.textXp || 0) + Number(previous?.voiceXp || 0);
    const minimumTotal = Math.max(0, Math.floor(Number(record.minimumTotalXp || 0)));
    if (currentTotal >= minimumTotal) return previous;
    return setUserXp(db, {
        ...record,
        textXp: minimumTotal,
        voiceXp: 0,
        source: record.source || 'minimum',
        xpType: 'combined',
        metadata: {
            ...(record.metadata || {}),
            previousTotalXp: currentTotal,
            minimumTotalXp: minimumTotal,
        },
    });
}

function listLevelXpEvents(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 100)));
    const userId = options.userId || null;
    if (guildId && userId) {
        return db.prepare('SELECT * FROM level_xp_events WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(guildId, userId, limit)
            .map(mapLevelXpEvent);
    }
    if (guildId) {
        return db.prepare('SELECT * FROM level_xp_events WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(guildId, limit)
            .map(mapLevelXpEvent);
    }
    return db.prepare('SELECT * FROM level_xp_events ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit)
        .map(mapLevelXpEvent);
}

function getActiveLevelImportJob(db, guildId) {
    return mapLevelImportJob(db.prepare("SELECT * FROM level_import_jobs WHERE guild_id = ? AND status IN ('queued', 'running', 'cancelling') ORDER BY updated_at DESC LIMIT 1").get(guildId));
}

function createLevelImportJob(db, record) {
    const timestamp = now();
    try {
        return db.transaction(() => {
            const active = getActiveLevelImportJob(db, record.guildId);
            if (active) return { ok: false, job: active, reason: 'active_job' };

            const job = {
                id: record.id || makeId(),
                guildId: record.guildId,
                targetUserId: record.targetUserId || null,
                status: record.status || 'queued',
                dryRun: record.dryRun !== false,
                profileHash: record.profileHash,
                profile: record.profile || {},
                createdBy: record.createdBy || null,
                provenance: record.provenance || {},
                createdAt: record.createdAt || timestamp,
            };
            db.prepare(`
                INSERT INTO level_import_jobs (
                    id, guild_id, target_user_id, status, dry_run, profile_hash, profile_json,
                    created_by, created_at, updated_at, provenance_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                job.id,
                job.guildId,
                job.targetUserId,
                job.status,
                job.dryRun ? 1 : 0,
                job.profileHash,
                stringify(job.profile, {}),
                job.createdBy,
                job.createdAt,
                timestamp,
                stringify(job.provenance, {}),
            );
            return { ok: true, job: getLevelImportJob(db, job.id) };
        })();
    } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            const active = getActiveLevelImportJob(db, record.guildId);
            if (active) return { ok: false, job: active, reason: 'active_job' };
        }
        throw error;
    }
}

function getLevelImportJob(db, id) {
    return mapLevelImportJob(db.prepare('SELECT * FROM level_import_jobs WHERE id = ?').get(id));
}

function listLevelImportJobs(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const statuses = Array.isArray(options.statuses) ? options.statuses.filter(Boolean) : [];
    if (guildId && statuses.length) {
        const placeholders = statuses.map(() => '?').join(', ');
        return db.prepare(`SELECT * FROM level_import_jobs WHERE guild_id = ? AND status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`)
            .all(guildId, ...statuses, limit)
            .map(mapLevelImportJob);
    }
    if (guildId) {
        return db.prepare('SELECT * FROM level_import_jobs WHERE guild_id = ? ORDER BY updated_at DESC LIMIT ?')
            .all(guildId, limit)
            .map(mapLevelImportJob);
    }
    if (statuses.length) {
        const placeholders = statuses.map(() => '?').join(', ');
        return db.prepare(`SELECT * FROM level_import_jobs WHERE status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`)
            .all(...statuses, limit)
            .map(mapLevelImportJob);
    }
    return db.prepare('SELECT * FROM level_import_jobs ORDER BY updated_at DESC LIMIT ?').all(limit).map(mapLevelImportJob);
}

function updateLevelImportJob(db, id, patch = {}) {
    const existing = getLevelImportJob(db, id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: patch.updatedAt || now() };
    db.prepare(`
        UPDATE level_import_jobs
        SET status = ?, dry_run = ?, profile_hash = ?, profile_json = ?, updated_at = ?,
            started_at = ?, completed_at = ?, current_channel_id = ?,
            channels_total = ?, channels_scanned = ?, messages_seen = ?, messages_eligible = ?,
            members_seen = ?, xp_estimated = ?, xp_applied = ?, skipped_channels_json = ?,
            errors_json = ?, cancel_requested = ?, provenance_json = ?, result_json = ?
        WHERE id = ?
    `).run(
        next.status,
        next.dryRun ? 1 : 0,
        next.profileHash,
        stringify(next.profile, {}),
        next.updatedAt,
        next.startedAt || null,
        next.completedAt || null,
        next.currentChannelId || null,
        Number(next.channelsTotal || 0),
        Number(next.channelsScanned || 0),
        Number(next.messagesSeen || 0),
        Number(next.messagesEligible || 0),
        Number(next.membersSeen || 0),
        Number(next.xpEstimated || 0),
        Number(next.xpApplied || 0),
        stringify(next.skippedChannels, []),
        stringify(next.errors, []),
        next.cancelRequested ? 1 : 0,
        stringify(next.provenance, {}),
        stringify(next.result, {}),
        id,
    );
    return getLevelImportJob(db, id);
}

function requestCancelLevelImportJob(db, id) {
    const job = getLevelImportJob(db, id);
    if (!job) return null;
    const status = ['completed', 'cancelled', 'failed', 'needs_confirmation'].includes(job.status) ? job.status : 'cancelling';
    return updateLevelImportJob(db, id, { status, cancelRequested: true });
}

function getActiveLevelCalibrationJob(db, guildId, importJobId = null) {
    if (importJobId) {
        return mapLevelCalibrationJob(db.prepare(`
            SELECT * FROM level_calibration_jobs
            WHERE guild_id = ? AND import_job_id = ? AND status IN ('queued', 'running', 'cancelling')
            ORDER BY updated_at DESC
            LIMIT 1
        `).get(guildId, importJobId));
    }
    return mapLevelCalibrationJob(db.prepare(`
        SELECT * FROM level_calibration_jobs
        WHERE guild_id = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY updated_at DESC
        LIMIT 1
    `).get(guildId));
}

function createLevelCalibrationJob(db, record) {
    const timestamp = now();
    try {
        return db.transaction(() => {
            const active = getActiveLevelCalibrationJob(db, record.guildId, record.importJobId);
            if (active) return { ok: false, job: active, reason: 'active_job' };

            const job = {
                id: record.id || makeId(),
                guildId: record.guildId,
                importJobId: record.importJobId,
                kind: record.kind || 'preview',
                status: record.status || 'queued',
                createdBy: record.createdBy || null,
                createdAt: record.createdAt || timestamp,
                profile: record.profile || {},
                options: record.options || {},
                progress: record.progress || {},
                result: record.result || {},
            };
            db.prepare(`
                INSERT INTO level_calibration_jobs (
                    id, guild_id, import_job_id, kind, status, created_by,
                    created_at, updated_at, started_at, completed_at,
                    profile_json, options_json, progress_json, result_json, error, cancel_requested
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0)
            `).run(
                job.id,
                job.guildId,
                job.importJobId,
                job.kind,
                job.status,
                job.createdBy,
                job.createdAt,
                timestamp,
                stringify(job.profile, {}),
                stringify(job.options, {}),
                stringify(job.progress, {}),
                stringify(job.result, {}),
            );
            return { ok: true, job: getLevelCalibrationJob(db, job.id) };
        })();
    } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            const active = getActiveLevelCalibrationJob(db, record.guildId, record.importJobId);
            if (active) return { ok: false, job: active, reason: 'active_job' };
        }
        throw error;
    }
}

function getLevelCalibrationJob(db, id) {
    return mapLevelCalibrationJob(db.prepare('SELECT * FROM level_calibration_jobs WHERE id = ?').get(id));
}

function listLevelCalibrationJobs(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const statuses = Array.isArray(options.statuses) ? options.statuses.filter(Boolean) : [];
    const importJobId = options.importJobId || null;
    const clauses = [];
    const params = [];

    if (guildId) {
        clauses.push('guild_id = ?');
        params.push(guildId);
    }
    if (importJobId) {
        clauses.push('import_job_id = ?');
        params.push(importJobId);
    }
    if (statuses.length) {
        clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM level_calibration_jobs ${where} ORDER BY updated_at DESC LIMIT ?`)
        .all(...params, limit)
        .map(mapLevelCalibrationJob);
}

function updateLevelCalibrationJob(db, id, patch = {}) {
    const existing = getLevelCalibrationJob(db, id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: patch.updatedAt || now() };
    db.prepare(`
        UPDATE level_calibration_jobs
        SET kind = ?, status = ?, updated_at = ?, started_at = ?, completed_at = ?,
            profile_json = ?, options_json = ?, progress_json = ?, result_json = ?,
            error = ?, cancel_requested = ?
        WHERE id = ?
    `).run(
        next.kind,
        next.status,
        next.updatedAt,
        next.startedAt || null,
        next.completedAt || null,
        stringify(next.profile, {}),
        stringify(next.options, {}),
        stringify(next.progress, {}),
        stringify(next.result, {}),
        next.error || null,
        next.cancelRequested ? 1 : 0,
        id,
    );
    return getLevelCalibrationJob(db, id);
}

function requestCancelLevelCalibrationJob(db, id) {
    const job = getLevelCalibrationJob(db, id);
    if (!job) return null;
    const status = ['completed', 'cancelled', 'failed'].includes(job.status) ? job.status : 'cancelling';
    return updateLevelCalibrationJob(db, id, { status, cancelRequested: true });
}

function getActiveLevelProbotScanJob(db, guildId, sourceChannelId = null) {
    if (sourceChannelId) {
        return mapLevelProbotScanJob(db.prepare(`
            SELECT * FROM level_probot_scan_jobs
            WHERE guild_id = ? AND source_channel_id = ? AND status IN ('queued', 'running', 'cancelling')
            ORDER BY updated_at DESC
            LIMIT 1
        `).get(guildId, sourceChannelId));
    }
    return mapLevelProbotScanJob(db.prepare(`
        SELECT * FROM level_probot_scan_jobs
        WHERE guild_id = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY updated_at DESC
        LIMIT 1
    `).get(guildId));
}

function createLevelProbotScanJob(db, record) {
    const timestamp = now();
    try {
        return db.transaction(() => {
            const active = getActiveLevelProbotScanJob(db, record.guildId, record.sourceChannelId);
            if (active) return { ok: false, job: active, reason: 'active_job' };

            const sourceChannelIds = [...new Set((record.sourceChannelIds?.length ? record.sourceChannelIds : [record.sourceChannelId]).map(String))];
            const job = {
                id: record.id || makeId(),
                guildId: record.guildId,
                sourceChannelId: record.sourceChannelId,
                sourceChannelIds,
                probotAuthorId: record.probotAuthorId,
                status: record.status || 'queued',
                createdBy: record.createdBy || null,
                createdAt: record.createdAt || timestamp,
                result: record.result || {},
            };
            db.prepare(`
                INSERT INTO level_probot_scan_jobs (
                    id, guild_id, source_channel_id, source_channel_ids_json, probot_author_id,
                    status, created_by, created_at, updated_at, channels_total, result_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                job.id,
                job.guildId,
                job.sourceChannelId,
                stringify(job.sourceChannelIds, []),
                job.probotAuthorId,
                job.status,
                job.createdBy,
                job.createdAt,
                timestamp,
                sourceChannelIds.length,
                stringify(job.result, {}),
            );
            return { ok: true, job: getLevelProbotScanJob(db, job.id) };
        })();
    } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            const active = getActiveLevelProbotScanJob(db, record.guildId, record.sourceChannelId);
            if (active) return { ok: false, job: active, reason: 'active_job' };
        }
        throw error;
    }
}

function getLevelProbotScanJob(db, id) {
    return mapLevelProbotScanJob(db.prepare('SELECT * FROM level_probot_scan_jobs WHERE id = ?').get(id));
}

function listLevelProbotScanJobs(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const statuses = Array.isArray(options.statuses) ? options.statuses.filter(Boolean) : [];
    const clauses = [];
    const params = [];

    if (guildId) {
        clauses.push('guild_id = ?');
        params.push(guildId);
    }
    if (statuses.length) {
        clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM level_probot_scan_jobs ${where} ORDER BY updated_at DESC LIMIT ?`)
        .all(...params, limit)
        .map(mapLevelProbotScanJob);
}

function updateLevelProbotScanJob(db, id, patch = {}) {
    const existing = getLevelProbotScanJob(db, id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: patch.updatedAt || now() };
    db.prepare(`
        UPDATE level_probot_scan_jobs
        SET source_channel_ids_json = ?, probot_author_id = ?, status = ?, updated_at = ?,
            started_at = ?, completed_at = ?, current_channel_id = ?,
            channels_total = ?, channels_scanned = ?, scanned_count = ?, matched_count = ?,
            verified_count = ?, unresolved_count = ?, invalid_count = ?, skipped_count = ?,
            duplicate_count = ?, oldest_scanned_at = ?, newest_scanned_at = ?,
            errors_json = ?, cancel_requested = ?, result_json = ?
        WHERE id = ?
    `).run(
        stringify(next.sourceChannelIds, []),
        next.probotAuthorId,
        next.status,
        next.updatedAt,
        next.startedAt || null,
        next.completedAt || null,
        next.currentChannelId || null,
        Number(next.channelsTotal || 0),
        Number(next.channelsScanned || 0),
        Number(next.scannedCount || 0),
        Number(next.matchedCount || 0),
        Number(next.verifiedCount || 0),
        Number(next.unresolvedCount || 0),
        Number(next.invalidCount || 0),
        Number(next.skippedCount || 0),
        Number(next.duplicateCount || 0),
        next.oldestScannedAt || null,
        next.newestScannedAt || null,
        stringify(next.errors, []),
        next.cancelRequested ? 1 : 0,
        stringify(next.result, {}),
        id,
    );
    return getLevelProbotScanJob(db, id);
}

function requestCancelLevelProbotScanJob(db, id) {
    const job = getLevelProbotScanJob(db, id);
    if (!job) return null;
    const status = ['completed', 'cancelled', 'failed'].includes(job.status) ? job.status : 'cancelling';
    return updateLevelProbotScanJob(db, id, { status, cancelRequested: true });
}

function upsertLevelProbotScanCheckpoint(db, record) {
    const timestamp = record.updatedAt || now();
    db.prepare(`
        INSERT INTO level_probot_scan_checkpoints (
            job_id, guild_id, channel_id, parent_channel_id, before_message_id,
            oldest_message_id, status, scanned_count, matched_count, verified_count,
            unresolved_count, invalid_count, skipped_count, duplicate_count,
            oldest_scanned_at, newest_scanned_at, error, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, channel_id) DO UPDATE SET
            parent_channel_id = excluded.parent_channel_id,
            before_message_id = excluded.before_message_id,
            oldest_message_id = excluded.oldest_message_id,
            status = excluded.status,
            scanned_count = excluded.scanned_count,
            matched_count = excluded.matched_count,
            verified_count = excluded.verified_count,
            unresolved_count = excluded.unresolved_count,
            invalid_count = excluded.invalid_count,
            skipped_count = excluded.skipped_count,
            duplicate_count = excluded.duplicate_count,
            oldest_scanned_at = excluded.oldest_scanned_at,
            newest_scanned_at = excluded.newest_scanned_at,
            error = excluded.error,
            updated_at = excluded.updated_at
    `).run(
        record.jobId,
        record.guildId,
        record.channelId,
        record.parentChannelId || null,
        record.beforeMessageId || null,
        record.oldestMessageId || null,
        record.status || 'pending',
        Number(record.scannedCount || 0),
        Number(record.matchedCount || 0),
        Number(record.verifiedCount || 0),
        Number(record.unresolvedCount || 0),
        Number(record.invalidCount || 0),
        Number(record.skippedCount || 0),
        Number(record.duplicateCount || 0),
        record.oldestScannedAt || null,
        record.newestScannedAt || null,
        record.error || null,
        timestamp,
    );
    return mapLevelProbotScanCheckpoint(db.prepare('SELECT * FROM level_probot_scan_checkpoints WHERE job_id = ? AND channel_id = ?').get(record.jobId, record.channelId));
}

function listLevelProbotScanCheckpoints(db, jobId = null) {
    const rows = jobId
        ? db.prepare('SELECT * FROM level_probot_scan_checkpoints WHERE job_id = ? ORDER BY updated_at DESC').all(jobId)
        : db.prepare('SELECT * FROM level_probot_scan_checkpoints ORDER BY updated_at DESC LIMIT 1000').all();
    return rows.map(mapLevelProbotScanCheckpoint);
}

function hasVerifiedProbotAnnouncementLevel(db, guildId, userId, level, excludeMessageId = null) {
    const row = excludeMessageId
        ? db.prepare(`
            SELECT 1 present
            FROM level_probot_announcements
            WHERE guild_id = ? AND target_user_id = ? AND announced_level = ?
                AND parse_status IN ('verified', 'repeated_verified')
                AND message_id != ?
            LIMIT 1
        `).get(guildId, userId, Number(level), excludeMessageId)
        : db.prepare(`
            SELECT 1 present
            FROM level_probot_announcements
            WHERE guild_id = ? AND target_user_id = ? AND announced_level = ?
                AND parse_status IN ('verified', 'repeated_verified')
            LIMIT 1
        `).get(guildId, userId, Number(level));
    return Boolean(row);
}

function isVerifiedProbotParseStatus(status) {
    return status === 'verified' || status === 'repeated_verified';
}

function insertLevelProbotAnnouncement(db, record) {
    let parseStatus = record.parseStatus;
    if (
        parseStatus === 'verified'
        && record.targetUserId
        && Number(record.announcedLevel || 0) > 0
        && hasVerifiedProbotAnnouncementLevel(db, record.guildId, record.targetUserId, record.announcedLevel, record.messageId)
    ) {
        parseStatus = 'repeated_verified';
    }

    const existing = db.prepare('SELECT * FROM level_probot_announcements WHERE guild_id = ? AND message_id = ?').get(record.guildId, record.messageId);
    const result = db.prepare(`
        INSERT INTO level_probot_announcements (
            guild_id, source_channel_id, message_id, job_id, probot_author_id,
            target_user_id, announced_level, announcement_timestamp, parser_version,
            parse_status, confidence, content_source, diagnostic_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, message_id) DO UPDATE SET
            source_channel_id = excluded.source_channel_id,
            job_id = excluded.job_id,
            probot_author_id = excluded.probot_author_id,
            target_user_id = excluded.target_user_id,
            announced_level = excluded.announced_level,
            announcement_timestamp = excluded.announcement_timestamp,
            parser_version = excluded.parser_version,
            parse_status = excluded.parse_status,
            confidence = excluded.confidence,
            content_source = excluded.content_source,
            diagnostic_json = excluded.diagnostic_json
        WHERE level_probot_announcements.parse_status NOT IN ('verified', 'repeated_verified')
            AND excluded.parse_status IN ('verified', 'repeated_verified')
    `).run(
        record.guildId,
        record.sourceChannelId,
        record.messageId,
        record.jobId || null,
        record.probotAuthorId,
        record.targetUserId || null,
        record.announcedLevel === null || record.announcedLevel === undefined ? null : Number(record.announcedLevel),
        Number(record.announcementTimestamp || 0),
        record.parserVersion,
        parseStatus,
        record.confidence || 'none',
        record.contentSource || null,
        stringify(record.diagnostic, {}),
        record.createdAt || now(),
    );
    const saved = db.prepare('SELECT * FROM level_probot_announcements WHERE guild_id = ? AND message_id = ?').get(record.guildId, record.messageId);
    return {
        inserted: !existing && result.changes > 0,
        updated: Boolean(existing && result.changes > 0 && !isVerifiedProbotParseStatus(existing.parse_status)),
        repeated: saved?.parse_status === 'repeated_verified',
        record: mapLevelProbotAnnouncement(saved),
    };
}

function listLevelProbotAnnouncements(db, guildId, options = {}) {
    const limit = Math.max(1, Math.min(100000, Number(options.limit || 1000)));
    const statuses = Array.isArray(options.statuses) ? options.statuses.filter(Boolean) : [];
    const userId = options.userId || null;
    const clauses = ['guild_id = ?'];
    const params = [guildId];

    if (userId) {
        clauses.push('target_user_id = ?');
        params.push(userId);
    }
    if (statuses.length) {
        clauses.push(`parse_status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }

    return db.prepare(`
        SELECT * FROM level_probot_announcements
        WHERE ${clauses.join(' AND ')}
        ORDER BY announcement_timestamp DESC, message_id DESC
        LIMIT ?
    `).all(...params, limit).map(mapLevelProbotAnnouncement);
}

function listHighestProbotAnnouncementLevels(db, guildId, options = {}) {
    const userIds = Array.isArray(options.userIds) ? [...new Set(options.userIds.map(String).filter(Boolean))] : [];
    const params = [guildId];
    const userWhere = userIds.length ? `AND target_user_id IN (${userIds.map(() => '?').join(', ')})` : '';
    params.push(...userIds);
    return db.prepare(`
        SELECT
            guild_id guildId,
            target_user_id userId,
            MAX(announced_level) announcementLevel,
            COUNT(*) announcementCount,
            MIN(announcement_timestamp) firstAnnouncementAt,
            MAX(announcement_timestamp) lastAnnouncementAt
        FROM level_probot_announcements
        WHERE guild_id = ?
            AND target_user_id IS NOT NULL
            AND announced_level > 0
            AND parse_status IN ('verified', 'repeated_verified')
            ${userWhere}
        GROUP BY guild_id, target_user_id
        ORDER BY announcementLevel DESC, target_user_id ASC
    `).all(...params);
}

function summarizeProbotAnnouncementEvidence(db, guildId) {
    const row = db.prepare(`
        SELECT
            COUNT(*) totalRecords,
            SUM(CASE WHEN parse_status IN ('verified', 'repeated_verified') THEN 1 ELSE 0 END) verifiedAnnouncements,
            COUNT(DISTINCT CASE WHEN parse_status IN ('verified', 'repeated_verified') THEN target_user_id END) uniqueVerifiedMembers,
            SUM(CASE WHEN parse_status = 'unresolved_identity' THEN 1 ELSE 0 END) unresolvedIdentities,
            SUM(CASE WHEN parse_status NOT IN ('verified', 'repeated_verified', 'unresolved_identity') THEN 1 ELSE 0 END) invalidRecords,
            SUM(CASE WHEN parse_status = 'repeated_verified' THEN 1 ELSE 0 END) repeatedAnnouncements,
            MAX(CASE WHEN parse_status IN ('verified', 'repeated_verified') THEN announced_level ELSE 0 END) highestRecoveredLevel
        FROM level_probot_announcements
        WHERE guild_id = ?
    `).get(guildId);
    return {
        totalRecords: Number(row?.totalRecords || 0),
        verifiedAnnouncements: Number(row?.verifiedAnnouncements || 0),
        uniqueVerifiedMembers: Number(row?.uniqueVerifiedMembers || 0),
        unresolvedIdentities: Number(row?.unresolvedIdentities || 0),
        invalidRecords: Number(row?.invalidRecords || 0),
        repeatedAnnouncements: Number(row?.repeatedAnnouncements || 0),
        highestRecoveredLevel: Number(row?.highestRecoveredLevel || 0),
    };
}

function upsertLevelImportCheckpoint(db, record) {
    const timestamp = record.updatedAt || now();
    db.prepare(`
        INSERT INTO level_import_checkpoints (
            job_id, guild_id, channel_id, parent_channel_id, before_message_id,
            oldest_message_id, status, messages_seen, messages_eligible, error, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, channel_id) DO UPDATE SET
            parent_channel_id = excluded.parent_channel_id,
            before_message_id = excluded.before_message_id,
            oldest_message_id = excluded.oldest_message_id,
            status = excluded.status,
            messages_seen = excluded.messages_seen,
            messages_eligible = excluded.messages_eligible,
            error = excluded.error,
            updated_at = excluded.updated_at
    `).run(
        record.jobId,
        record.guildId,
        record.channelId,
        record.parentChannelId || null,
        record.beforeMessageId || null,
        record.oldestMessageId || null,
        record.status || 'pending',
        Number(record.messagesSeen || 0),
        Number(record.messagesEligible || 0),
        record.error || null,
        timestamp,
    );
    return mapLevelImportCheckpoint(db.prepare('SELECT * FROM level_import_checkpoints WHERE job_id = ? AND channel_id = ?').get(record.jobId, record.channelId));
}

function listLevelImportCheckpoints(db, jobId = null) {
    const rows = jobId
        ? db.prepare('SELECT * FROM level_import_checkpoints WHERE job_id = ? ORDER BY updated_at DESC').all(jobId)
        : db.prepare('SELECT * FROM level_import_checkpoints ORDER BY updated_at DESC LIMIT 1000').all();
    return rows.map(mapLevelImportCheckpoint);
}

function insertLevelImportMessage(db, record) {
    const result = db.prepare(`
        INSERT OR IGNORE INTO level_import_messages (
            job_id, guild_id, message_id, user_id, user_tag, channel_id,
            created_at, xp_amount, eligible, skip_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.jobId,
        record.guildId,
        record.messageId,
        record.userId,
        record.userTag || null,
        record.channelId,
        Number(record.createdAt || 0),
        Number(record.xpAmount || 0),
        record.eligible === false ? 0 : 1,
        record.skipReason || null,
    );
    return result.changes > 0;
}

function listLevelImportMessages(db, jobId = null, options = {}) {
    const requestedLimit = Number(options.limit || 10000);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 10000;
    const userId = options.userId || null;
    if (jobId && userId) {
        return db.prepare('SELECT * FROM level_import_messages WHERE job_id = ? AND user_id = ? ORDER BY created_at ASC, message_id ASC LIMIT ?')
            .all(jobId, userId, limit)
            .map(mapLevelImportMessage);
    }
    if (jobId) {
        return db.prepare('SELECT * FROM level_import_messages WHERE job_id = ? ORDER BY created_at ASC, message_id ASC LIMIT ?')
            .all(jobId, limit)
            .map(mapLevelImportMessage);
    }
    return db.prepare('SELECT * FROM level_import_messages ORDER BY created_at DESC LIMIT ?').all(limit).map(mapLevelImportMessage);
}

function listLevelImportMessagesPage(db, jobId, options = {}) {
    const requestedLimit = Number(options.limit || 1000);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10000, Math.floor(requestedLimit))) : 1000;
    const afterCreatedAt = options.afterCreatedAt === undefined ? null : Number(options.afterCreatedAt);
    const afterMessageId = options.afterMessageId || '';
    const userId = options.userId || null;

    if (userId && afterCreatedAt !== null) {
        return db.prepare(`
            SELECT * FROM level_import_messages
            WHERE job_id = ?
                AND user_id = ?
                AND (created_at > ? OR (created_at = ? AND message_id > ?))
            ORDER BY created_at ASC, message_id ASC
            LIMIT ?
        `).all(jobId, userId, afterCreatedAt, afterCreatedAt, afterMessageId, limit).map(mapLevelImportMessage);
    }

    if (userId) {
        return db.prepare(`
            SELECT * FROM level_import_messages
            WHERE job_id = ? AND user_id = ?
            ORDER BY created_at ASC, message_id ASC
            LIMIT ?
        `).all(jobId, userId, limit).map(mapLevelImportMessage);
    }

    if (afterCreatedAt !== null) {
        return db.prepare(`
            SELECT * FROM level_import_messages
            WHERE job_id = ?
                AND (created_at > ? OR (created_at = ? AND message_id > ?))
            ORDER BY created_at ASC, message_id ASC
            LIMIT ?
        `).all(jobId, afterCreatedAt, afterCreatedAt, afterMessageId, limit).map(mapLevelImportMessage);
    }

    return db.prepare(`
        SELECT * FROM level_import_messages
        WHERE job_id = ?
        ORDER BY created_at ASC, message_id ASC
        LIMIT ?
    `).all(jobId, limit).map(mapLevelImportMessage);
}

function countProcessedLevelMessage(db, guildId, messageId, profileHash) {
    return db.prepare('SELECT COUNT(*) count FROM level_import_processed_messages WHERE guild_id = ? AND message_id = ? AND profile_hash = ?')
        .get(guildId, messageId, profileHash).count;
}

function markLevelImportMessageProcessed(db, record) {
    const result = db.prepare(`
        INSERT OR IGNORE INTO level_import_processed_messages (
            guild_id, message_id, profile_hash, job_id, user_id, channel_id, xp_amount, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.guildId,
        record.messageId,
        record.profileHash,
        record.jobId,
        record.userId,
        record.channelId,
        Number(record.xpAmount || 0),
        record.createdAt || now(),
    );
    return result.changes > 0;
}

function listLevelProcessedMessages(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(100000, Number(options.limit || 10000)));
    const rows = guildId
        ? db.prepare('SELECT guild_id guildId, message_id messageId, profile_hash profileHash, job_id jobId, user_id userId, channel_id channelId, xp_amount xpAmount, created_at createdAt FROM level_import_processed_messages WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit)
        : db.prepare('SELECT guild_id guildId, message_id messageId, profile_hash profileHash, job_id jobId, user_id userId, channel_id channelId, xp_amount xpAmount, created_at createdAt FROM level_import_processed_messages ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows;
}

function upsertLevelRoleMapping(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO level_role_level_mappings (guild_id, role_id, minimum_level, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, role_id) DO UPDATE SET
            minimum_level = excluded.minimum_level,
            created_by = excluded.created_by,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.roleId, Number(record.minimumLevel || 0), record.createdBy || null, record.createdAt || timestamp, timestamp);
    return mapLevelRoleMapping(db.prepare('SELECT * FROM level_role_level_mappings WHERE guild_id = ? AND role_id = ?').get(record.guildId, record.roleId));
}

function removeLevelRoleMapping(db, guildId, roleId) {
    return db.prepare('DELETE FROM level_role_level_mappings WHERE guild_id = ? AND role_id = ?').run(guildId, roleId).changes;
}

function listLevelRoleMappings(db, guildId = null) {
    const rows = guildId
        ? db.prepare('SELECT * FROM level_role_level_mappings WHERE guild_id = ? ORDER BY minimum_level ASC, role_id ASC').all(guildId)
        : db.prepare('SELECT * FROM level_role_level_mappings ORDER BY guild_id ASC, minimum_level ASC, role_id ASC').all();
    return rows.map(mapLevelRoleMapping);
}

function insertLevelReconciliationRecord(db, record) {
    const timestamp = record.createdAt || now();
    const result = db.prepare(`
        INSERT INTO level_reconciliation_records (
            job_id, guild_id, user_id, user_tag, existing_xp, message_estimated_xp,
            message_estimated_level, role_min_level, role_min_xp, final_xp,
            policy, dry_run, applied, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.jobId || null,
        record.guildId,
        record.userId,
        record.userTag || null,
        Number(record.existingXp || 0),
        Number(record.messageEstimatedXp || 0),
        Number(record.messageEstimatedLevel || 0),
        Number(record.roleMinLevel || 0),
        Number(record.roleMinXp || 0),
        Number(record.finalXp || 0),
        record.policy || 'max',
        record.dryRun === false ? 0 : 1,
        record.applied ? 1 : 0,
        stringify(record.metadata, {}),
        timestamp,
    );
    return mapLevelReconciliation(db.prepare('SELECT * FROM level_reconciliation_records WHERE id = ?').get(result.lastInsertRowid));
}

function listLevelReconciliationRecords(db, jobId = null, options = {}) {
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 100)));
    const rows = jobId
        ? db.prepare('SELECT * FROM level_reconciliation_records WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(jobId, limit)
        : db.prepare('SELECT * FROM level_reconciliation_records ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
    return rows.map(mapLevelReconciliation);
}

function createLevelTestSession(db, record) {
    const timestamp = record.createdAt || now();
    const session = {
        id: record.id || makeId(),
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag || null,
        adminId: record.adminId,
        status: record.status || (record.previewOnly ? 'preview' : 'active'),
        previewOnly: record.previewOnly !== false,
        previousTextXp: Number(record.previousTextXp || 0),
        previousVoiceXp: Number(record.previousVoiceXp || 0),
        xpDelta: Number(record.xpDelta || 0),
        xpType: record.xpType || 'text',
        managedRoleIds: record.managedRoleIds || [],
        addedRoleIds: record.addedRoleIds || [],
        removedRoleIds: record.removedRoleIds || [],
        metadata: record.metadata || {},
        createdAt: timestamp,
    };
    db.prepare(`
        INSERT INTO level_test_sessions (
            id, guild_id, user_id, user_tag, admin_id, status, preview_only,
            previous_text_xp, previous_voice_xp, xp_delta, xp_type,
            managed_role_ids_json, added_role_ids_json, removed_role_ids_json,
            metadata_json, created_at, updated_at, rolled_back_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
        session.id,
        session.guildId,
        session.userId,
        session.userTag,
        session.adminId,
        session.status,
        session.previewOnly ? 1 : 0,
        session.previousTextXp,
        session.previousVoiceXp,
        session.xpDelta,
        session.xpType,
        stringify(session.managedRoleIds, []),
        stringify(session.addedRoleIds, []),
        stringify(session.removedRoleIds, []),
        stringify(session.metadata, {}),
        session.createdAt,
        timestamp,
    );
    return getLevelTestSession(db, session.id);
}

function getLevelTestSession(db, id) {
    return mapLevelTestSession(db.prepare('SELECT * FROM level_test_sessions WHERE id = ?').get(id));
}

function listLevelTestSessions(db, guildId = null, options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const userId = options.userId || null;
    if (guildId && userId) {
        return db.prepare('SELECT * FROM level_test_sessions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(guildId, userId, limit)
            .map(mapLevelTestSession);
    }
    if (guildId) {
        return db.prepare('SELECT * FROM level_test_sessions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(guildId, limit)
            .map(mapLevelTestSession);
    }
    return db.prepare('SELECT * FROM level_test_sessions ORDER BY created_at DESC LIMIT ?').all(limit).map(mapLevelTestSession);
}

function updateLevelTestSession(db, id, patch = {}) {
    const existing = getLevelTestSession(db, id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: patch.updatedAt || now() };
    db.prepare(`
        UPDATE level_test_sessions
        SET status = ?, preview_only = ?, xp_delta = ?, xp_type = ?,
            managed_role_ids_json = ?, added_role_ids_json = ?, removed_role_ids_json = ?,
            metadata_json = ?, updated_at = ?, rolled_back_at = ?
        WHERE id = ?
    `).run(
        next.status,
        next.previewOnly ? 1 : 0,
        Number(next.xpDelta || 0),
        next.xpType || 'text',
        stringify(next.managedRoleIds, []),
        stringify(next.addedRoleIds, []),
        stringify(next.removedRoleIds, []),
        stringify(next.metadata, {}),
        next.updatedAt,
        next.rolledBackAt || null,
        id,
    );
    return getLevelTestSession(db, id);
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

function listAllGuildSettings(db) {
    return db.prepare('SELECT * FROM guild_settings ORDER BY guild_id ASC, section ASC, setting_key ASC').all().map(mapGuildSetting);
}

function listGuildSettings(db, guildId) {
    return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ? ORDER BY section ASC, setting_key ASC').all(guildId).map(mapGuildSetting);
}

function listAllGuildLogChannels(db) {
    return db.prepare('SELECT * FROM guild_log_channels ORDER BY guild_id ASC, log_key ASC').all().map(mapGuildLogChannel);
}

function listGuildLogChannels(db, guildId) {
    return db.prepare('SELECT * FROM guild_log_channels WHERE guild_id = ? ORDER BY log_key ASC').all(guildId).map(mapGuildLogChannel);
}

function listAllGuildLevelRewards(db) {
    return db.prepare('SELECT * FROM guild_level_rewards ORDER BY guild_id ASC, xp ASC, role_id ASC').all().map(mapGuildLevelReward);
}

function listGuildLevelRewards(db, guildId) {
    return db.prepare('SELECT * FROM guild_level_rewards WHERE guild_id = ? ORDER BY xp ASC, role_id ASC').all(guildId).map(mapGuildLevelReward);
}

function upsertGuildSetting(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO guild_settings (guild_id, section, setting_key, value_json, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, section, setting_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.section, record.key, stringify(record.value, null), record.updatedBy || null, record.createdAt || timestamp, record.updatedAt || timestamp);
}

function upsertGuildLogChannel(db, record) {
    const timestamp = now();
    db.prepare(`
        INSERT INTO guild_log_channels (guild_id, log_key, channel_id, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, log_key) DO UPDATE SET
            channel_id = excluded.channel_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
    `).run(record.guildId, record.key, record.channelId ?? '', record.updatedBy || null, record.createdAt || timestamp, record.updatedAt || timestamp);
}

function replaceGuildLevelRewards(db, guildId, rewards = [], updatedBy = null) {
    const timestamp = now();
    db.prepare('DELETE FROM guild_level_rewards WHERE guild_id = ?').run(guildId);
    const insert = db.prepare(`
        INSERT INTO guild_level_rewards (guild_id, role_id, xp, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const reward of rewards) {
        if (!reward?.roleId) continue;
        insert.run(guildId, reward.roleId, Number(reward.xp || 0), updatedBy, reward.createdAt || timestamp, reward.updatedAt || timestamp);
    }
    upsertGuildSetting(db, {
        guildId,
        section: 'leveling',
        key: 'roleRewards',
        value: rewards
            .map(reward => ({
                xp: Number(reward.xp || 0),
                level: reward.level === undefined ? undefined : Number(reward.level || 0),
                roleId: reward.roleId,
            }))
            .filter(reward => reward.roleId),
        updatedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
    });
}

function addConfigAuditEntries(db, entries = []) {
    if (!entries.length) return 0;
    const insert = db.prepare(`
        INSERT INTO guild_config_audit (guild_id, actor_id, section, setting_key, previous_value, new_value, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of entries) {
        insert.run(
            entry.guildId,
            entry.actorId || null,
            entry.section,
            entry.key,
            entry.previousValue,
            entry.newValue,
            entry.source,
            entry.createdAt || now(),
        );
    }
    return entries.length;
}

function pruneConfigAuditEntries(db, maxEntries = 5000) {
    return pruneTableByNewest(db, 'guild_config_audit', maxEntries);
}

function listConfigAudit(db, guildId, options = {}) {
    const limit = Math.max(1, Math.min(250, Number(options.limit || 50)));
    const offset = Math.max(0, Number(options.offset || 0));

    if (guildId && options.section) {
        return db.prepare('SELECT * FROM guild_config_audit WHERE guild_id = ? AND section = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
            .all(guildId, options.section, limit, offset)
            .map(mapConfigAudit);
    }

    if (guildId) {
        return db.prepare('SELECT * FROM guild_config_audit WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
            .all(guildId, limit, offset)
            .map(mapConfigAudit);
    }

    return db.prepare('SELECT * FROM guild_config_audit ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
        .all(limit, offset)
        .map(mapConfigAudit);
}

function saveGuildConfigurationSection(db, guildId, section, payload = {}, metadata = {}) {
    db.transaction(() => {
        const timestamp = metadata.updatedAt || now();
        for (const [key, value] of Object.entries(payload.settings || {})) {
            upsertGuildSetting(db, {
                guildId,
                section,
                key,
                value,
                updatedBy: metadata.actorId || null,
                createdAt: timestamp,
                updatedAt: timestamp,
            });
        }

        if (payload.logChannels) {
            for (const [key, channelId] of Object.entries(payload.logChannels)) {
                upsertGuildLogChannel(db, {
                    guildId,
                    key,
                    channelId: channelId ?? '',
                    updatedBy: metadata.actorId || null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            }
        }

        if (payload.levelRewards) {
            replaceGuildLevelRewards(db, guildId, payload.levelRewards, metadata.actorId || null);
        }

        addConfigAuditEntries(db, payload.auditEntries || []);
        pruneConfigAuditEntries(db, metadata.retention?.guildConfigAuditMaxEntries);
    })();
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
    count('guildSettings', state.guildSettings, record => upsertGuildSetting(db, record));
    count('guildLogChannels', state.guildLogChannels, record => upsertGuildLogChannel(db, record));
    count('guildLevelRewards', state.guildLevelRewards, record => {
        db.prepare(`
            INSERT INTO guild_level_rewards (guild_id, role_id, xp, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, role_id) DO UPDATE SET
                xp = excluded.xp,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `).run(record.guildId, record.roleId, Number(record.xp || 0), record.updatedBy || null, record.createdAt || now(), record.updatedAt || now());
    });
    count('configAudit', state.configAudit, record => addConfigAuditEntries(db, [record]));
    count('limitedAccounts', state.limitedAccounts, record => honeypotLimitedAccountsRepository.upsertLimitedAccount(db, record));
    count('levelXpEvents', state.levelXpEvents, record => insertLevelXpEvent(db, record));
    count('levelImportJobs', state.levelImportJobs, record => createLevelImportJob(db, record));
    count('levelImportCheckpoints', state.levelImportCheckpoints, record => upsertLevelImportCheckpoint(db, record));
    count('levelImportMessages', state.levelImportMessages, record => insertLevelImportMessage(db, record));
    count('levelCalibrationJobs', state.levelCalibrationJobs, record => createLevelCalibrationJob(db, record));
    count('levelProbotScanJobs', state.levelProbotScanJobs, record => createLevelProbotScanJob(db, record));
    count('levelProbotScanCheckpoints', state.levelProbotScanCheckpoints, record => upsertLevelProbotScanCheckpoint(db, record));
    count('levelProbotAnnouncements', state.levelProbotAnnouncements, record => insertLevelProbotAnnouncement(db, record));
    count('levelProcessedMessages', state.levelProcessedMessages, record => markLevelImportMessageProcessed(db, record));
    count('levelRoleMappings', state.levelRoleMappings, record => upsertLevelRoleMapping(db, record));
    count('levelReconciliationRecords', state.levelReconciliationRecords, record => insertLevelReconciliationRecord(db, record));
    count('levelTestSessions', state.levelTestSessions, record => createLevelTestSession(db, record));

    return counts;
}

module.exports = {
    ...honeypotLimitedAccountsRepository,
    addModNote,
    addUserHistory,
    addUserXp,
    adjustUserXp,
    appendVoiceActivity,
    clearWarningCases,
    countActiveModerationCases,
    countProcessedLevelMessage,
    createLevelCalibrationJob,
    createLevelImportJob,
    createLevelProbotScanJob,
    createLevelTestSession,
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
    getLevelCalibrationJob,
    getLevelImportJob,
    getLevelProbotScanJob,
    getLevelRank,
    getLevelTestSession,
    getUserLevelRecord,
    insertLevelImportMessage,
    insertLevelProbotAnnouncement,
    insertLevelReconciliationRecord,
    insertLevelXpEvent,
    importState,
    listConfigAudit,
    listCommandStats,
    listDueReminders,
    listDueScheduledMessages,
    listEmbedTemplates,
    listGuildHistory,
    listExpiredTempBans,
    listExpiredTempMutes,
    listExpiredTempRoles,
    listGuildLevelRewards,
    listGuildLogChannels,
    listGuildSettings,
    listLevelLeaderboard,
    listLevelCalibrationJobs,
    listLevelImportCheckpoints,
    listLevelImportJobs,
    listLevelImportMessages,
    listLevelImportMessagesPage,
    listLevelProbotAnnouncements,
    listLevelProbotScanCheckpoints,
    listLevelProbotScanJobs,
    listHighestProbotAnnouncementLevels,
    listLevelProcessedMessages,
    listLevelReconciliationRecords,
    listLevelRoleMappings,
    listLevelTestSessions,
    listLevelXpEvents,
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
    removeLevelRoleMapping,
    requestCancelLevelImportJob,
    requestCancelLevelProbotScanJob,
    requestCancelLevelCalibrationJob,
    summarizeProbotAnnouncementEvidence,
    markLevelImportMessageProcessed,
    updateModerationCaseReason,
    updateReminderStatus,
    markScheduledJobFinish,
    markScheduledJobStart,
    saveGuildConfigurationSection,
    setUserXp,
    setUserXpMinimum,
    updateLevelImportJob,
    updateLevelProbotScanJob,
    updateLevelCalibrationJob,
    updateLevelTestSession,
    updateScheduledMessageStatus,
    upsertEmbedTemplate,
    upsertLevelImportCheckpoint,
    upsertLevelProbotScanCheckpoint,
    upsertLevelRoleMapping,
    upsertStarboardMessage,
    upsertTempBan,
    upsertTempMute,
    upsertTempRole,
    upsertTempVoiceChannel,
    upsertTicketRecord,
};
