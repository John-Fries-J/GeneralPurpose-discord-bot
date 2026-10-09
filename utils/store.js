const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');
const database = require('../database');
const repository = require('../database/repositories');
const { makeId } = require('../database/repositories/ids');

let stateMutationQueue = Promise.resolve();

function resolveDataPath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.jsonPath || 'data/bot-state.json');
}

function resolveSqlitePath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.sqlitePath || 'data/bot.sqlite');
}

function createEmptyState() {
    return {
        cases: [],
        commandStats: [],
        embedTemplates: [],
        history: [],
        levels: [],
        modNotes: [],
        nextCaseId: 1,
        reactionRoles: [],
        reminders: [],
        scheduledMessages: [],
        starboardMessages: [],
        tempBans: [],
        tempMutes: [],
        tempRoles: [],
        tempVoiceChannels: [],
        ticketTranscripts: [],
        ticketRecords: [],
        voiceActivity: [],
        guildSettings: [],
        guildLogChannels: [],
        guildLevelRewards: [],
        configAudit: [],
        limitedAccounts: [],
        levelXpEvents: [],
        levelImportJobs: [],
        levelImportCheckpoints: [],
        levelImportMessages: [],
        levelCalibrationJobs: [],
        levelProbotScanJobs: [],
        levelProbotScanCheckpoints: [],
        levelProbotAnnouncements: [],
        levelProbotMigrationBatches: [],
        levelProbotMigrationSnapshots: [],
        levelProcessedMessages: [],
        levelRoleMappings: [],
        levelReconciliationRecords: [],
        levelTestSessions: [],
    };
}

function readJsonState(filePath) {
    if (!fs.existsSync(filePath)) return createEmptyState();
    return {
        ...createEmptyState(),
        ...JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
}

function writeJsonState(filePath, state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ ...createEmptyState(), ...state }, null, 4)}\n`);
}

function redactConnectionString(value = '') {
    if (!value) return '[not configured]';

    try {
        const url = new URL(value);
        if (url.username) url.username = '[user]';
        if (url.password) url.password = '[password]';
        return url.toString();
    } catch {
        return '[configured]';
    }
}

function getStorageSettings() {
    const config = getConfig();
    const provider = config.database?.provider || 'sqlite';

    if (!['json', 'sqlite', 'mysql'].includes(provider)) {
        console.warn(`[DATABASE] Provider "${provider}" is configured but this build only includes JSON, SQLite, and MySQL adapters. Falling back to SQLite storage.`);
    }

    return {
        provider: ['json', 'sqlite', 'mysql'].includes(provider) ? provider : 'sqlite',
        jsonPath: resolveDataPath(config),
        sqlitePath: resolveSqlitePath(config),
        mysqlUrl: config.database?.mysql?.url || '',
    };
}

async function openMysqlConnection(settings) {
    if (!settings.mysqlUrl) {
        throw new Error('MySQL storage is selected, but database.mysql.url is not configured.');
    }

    const mysql = require('mysql2/promise');

    try {
        const connection = await mysql.createConnection(settings.mysqlUrl);
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS bot_state (
                \`key\` VARCHAR(128) PRIMARY KEY,
                \`value\` LONGTEXT NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        return connection;
    } catch (error) {
        throw new Error(`MySQL storage connection failed (${redactConnectionString(settings.mysqlUrl)}): ${error.message}`);
    }
}

async function readMysqlState(settings) {
    const connection = await openMysqlConnection(settings);
    try {
        const [rows] = await connection.execute('SELECT `key`, `value` FROM bot_state');
        const state = createEmptyState();

        for (const row of rows) {
            if (row.key in state) {
                state[row.key] = JSON.parse(row.value);
            }
        }

        return state;
    } finally {
        await connection.end();
    }
}

async function writeMysqlState(settings, state) {
    const connection = await openMysqlConnection(settings);
    try {
        const preparedState = { ...createEmptyState(), ...state };
        await connection.beginTransaction();
        for (const [key, value] of Object.entries(preparedState)) {
            await connection.execute(`
                INSERT INTO bot_state (\`key\`, \`value\`, updated_at)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    \`value\` = VALUES(\`value\`),
                    updated_at = VALUES(updated_at)
            `, [key, JSON.stringify(value), Date.now()]);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => null);
        throw error;
    } finally {
        await connection.end();
    }
}

function getHistorySettings(config = getConfig()) {
    const maxEntries = Number(config.history?.maxEntries || 50_000);

    return {
        enabled: config.history?.enabled !== false,
        recordMessages: config.history?.recordMessages !== false,
        recordCommands: config.history?.recordCommands !== false,
        maxEntries: Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 50_000,
    };
}

function boundedPositiveInteger(value, fallback, { min = 1, max = 1_000_000 } = {}) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function getRetentionSettings(config = getConfig()) {
    const retention = config.retention || {};
    return {
        commandUsageMaxEntries: boundedPositiveInteger(retention.commandUsageMaxEntries, 10_000),
        voiceActivityMaxEntries: boundedPositiveInteger(retention.voiceActivityMaxEntries, 5_000),
        guildConfigAuditMaxEntries: boundedPositiveInteger(retention.guildConfigAuditMaxEntries, 5_000),
    };
}

function shouldRecordHistoryEntry(entry, settings = getHistorySettings()) {
    if (!settings.enabled) return false;
    if (entry.type === 'message' && !settings.recordMessages) return false;
    if ((entry.type === 'command' || entry.type === 'command:error') && !settings.recordCommands) return false;
    return true;
}

async function getSqliteDb() {
    const settings = getStorageSettings();
    const initialized = await database.initializeDatabase({
        sqlitePath: settings.sqlitePath,
        jsonPath: settings.jsonPath,
    });
    return initialized.db;
}

async function initializeStorage() {
    const settings = getStorageSettings();

    if (settings.provider === 'json') {
        console.log(`[DATABASE] Active provider: json (${settings.jsonPath})`);
        return;
    }

    if (settings.provider === 'mysql') {
        const connection = await openMysqlConnection(settings);
        await connection.end();
        console.log(`[DATABASE] Active provider: mysql (${redactConnectionString(settings.mysqlUrl)})`);
        return;
    }

    const result = await database.initializeDatabase({
        sqlitePath: settings.sqlitePath,
        jsonPath: settings.jsonPath,
    });
    if (result.legacy?.source) {
        console.log(`[DATABASE] Migrated legacy ${result.legacy.source} state into normalized SQLite schema: ${JSON.stringify(result.legacy.counts)}`);
        for (const backup of result.legacy.backups || []) {
            console.log(`[DATABASE] Legacy state backup created at ${backup}`);
        }
    }
    console.log(`[DATABASE] Active provider: sqlite (${settings.sqlitePath})`);
}

async function readState() {
    const settings = getStorageSettings();

    if (settings.provider === 'json') return readJsonState(settings.jsonPath);
    if (settings.provider === 'mysql') return readMysqlState(settings);
    return repository.readState(await getSqliteDb());
}

function clearNormalizedState(db) {
    db.exec(`
        DELETE FROM moderation_notes;
        DELETE FROM moderation_cases;
        DELETE FROM temporary_bans;
        DELETE FROM temporary_mutes;
        DELETE FROM temporary_roles;
        DELETE FROM reminders;
        DELETE FROM scheduled_messages;
        DELETE FROM scheduled_jobs;
        DELETE FROM levels;
        DELETE FROM reaction_roles;
        DELETE FROM ticket_members;
        DELETE FROM ticket_transcripts;
        DELETE FROM tickets;
        DELETE FROM temporary_voice_channels;
        DELETE FROM voice_activity;
        DELETE FROM command_usage;
        DELETE FROM user_history;
        DELETE FROM embed_templates;
        DELETE FROM starboard_messages;
        DELETE FROM guild_config_audit;
        DELETE FROM guild_level_rewards;
        DELETE FROM guild_log_channels;
        DELETE FROM guild_settings;
        DELETE FROM honeypot_limited_accounts;
        DELETE FROM level_xp_events;
        DELETE FROM level_import_messages;
        DELETE FROM level_import_checkpoints;
        DELETE FROM level_import_processed_messages;
        DELETE FROM level_calibration_jobs;
        DELETE FROM level_probot_migration_snapshots;
        DELETE FROM level_probot_migration_batches;
        DELETE FROM level_probot_announcements;
        DELETE FROM level_probot_scan_checkpoints;
        DELETE FROM level_probot_scan_jobs;
        DELETE FROM level_import_jobs;
        DELETE FROM level_role_level_mappings;
        DELETE FROM level_reconciliation_records;
        DELETE FROM level_test_sessions;
    `);
}

async function writeState(state) {
    const settings = getStorageSettings();

    if (settings.provider === 'json') {
        writeJsonState(settings.jsonPath, state);
        return;
    }

    if (settings.provider === 'mysql') {
        await writeMysqlState(settings, state);
        return;
    }

    const db = await getSqliteDb();
    db.transaction(() => {
        clearNormalizedState(db);
        repository.importState(db, { ...createEmptyState(), ...state });
    })();
}

async function updateState(updater) {
    const run = stateMutationQueue.then(async () => {
        const state = await readState();
        const nextState = updater(state) || state;
        await writeState(nextState);
        return nextState;
    });

    stateMutationQueue = run.catch(() => null);
    return run;
}

function useLegacyStateMutation(fn) {
    return updateState(fn);
}

async function upsertTempBan(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertTempBan(await getSqliteDb(), record);
    return useLegacyStateMutation(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempBans.push(record);
        return state;
    });
}

async function removeTempBan(guildId, userId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.removeTempBan(await getSqliteDb(), guildId, userId);
    return useLegacyStateMutation(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

async function upsertTempMute(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertTempMute(await getSqliteDb(), record);
    return useLegacyStateMutation(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempMutes.push(record);
        return state;
    });
}

async function removeTempMute(guildId, userId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.removeTempMute(await getSqliteDb(), guildId, userId);
    return useLegacyStateMutation(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

async function getTempMute(guildId, userId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getTempMute(await getSqliteDb(), guildId, userId);
    return (await readState()).tempMutes.find(item => item.guildId === guildId && item.userId === userId) || null;
}

function normalizeLimitedAccount(record, overrides = {}) {
    const timestamp = overrides.timestamp || Date.now();
    return {
        guildId: record.guildId,
        userId: record.userId,
        previousRoleIds: Array.isArray(record.previousRoleIds) ? [...new Set(record.previousRoleIds.map(String))] : [],
        limitedRoleId: record.limitedRoleId,
        limitedChannelId: record.limitedChannelId || null,
        limitedBy: record.limitedBy || null,
        limitedAt: record.limitedAt || timestamp,
        restoredBy: record.restoredBy || null,
        restoredAt: record.restoredAt || null,
        restorationSource: record.restorationSource || null,
        status: record.status || 'active',
        createdAt: record.createdAt || timestamp,
        updatedAt: record.updatedAt || timestamp,
    };
}

async function getLimitedAccount(guildId, userId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLimitedAccount(await getSqliteDb(), guildId, userId);
    return ((await readState()).limitedAccounts || []).find(item => item.guildId === guildId && item.userId === userId) || null;
}

async function listLimitedAccounts(guildId = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLimitedAccounts(await getSqliteDb(), guildId);
    return ((await readState()).limitedAccounts || [])
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function upsertLimitedAccount(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertLimitedAccount(await getSqliteDb(), record);

    let saved = null;
    await useLegacyStateMutation(state => {
        state.limitedAccounts ||= [];
        saved = normalizeLimitedAccount(record);
        state.limitedAccounts = state.limitedAccounts.filter(item => !(item.guildId === saved.guildId && item.userId === saved.userId));
        state.limitedAccounts.push(saved);
        return state;
    });
    return saved;
}

async function beginLimitedAccount(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.beginLimitedAccount(await getSqliteDb(), record);

    let result = null;
    await useLegacyStateMutation(state => {
        state.limitedAccounts ||= [];
        const existing = state.limitedAccounts.find(item => item.guildId === record.guildId && item.userId === record.userId) || null;
        if (existing?.status === 'active') {
            result = { ok: false, record: existing };
            return state;
        }

        const account = normalizeLimitedAccount({
            ...record,
            restoredBy: null,
            restoredAt: null,
            restorationSource: null,
            status: 'active',
        });
        state.limitedAccounts = state.limitedAccounts.filter(item => !(item.guildId === account.guildId && item.userId === account.userId));
        state.limitedAccounts.push(account);
        result = { ok: true, record: account };
        return state;
    });
    return result;
}

async function markLimitedAccountRestored(guildId, userId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.markLimitedAccountRestored(await getSqliteDb(), guildId, userId, options);

    let updated = null;
    await useLegacyStateMutation(state => {
        state.limitedAccounts ||= [];
        const record = state.limitedAccounts.find(item => item.guildId === guildId && item.userId === userId) || null;
        if (!record) return state;
        if (record.status === 'restored') {
            updated = record;
            return state;
        }

        const timestamp = options.restoredAt || Date.now();
        record.status = 'restored';
        record.restoredBy = options.restoredBy || null;
        record.restoredAt = timestamp;
        record.restorationSource = options.restorationSource || 'unknown';
        record.updatedAt = timestamp;
        updated = record;
        return state;
    });
    return updated;
}

async function markLimitedAccountFailed(guildId, userId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.markLimitedAccountFailed(await getSqliteDb(), guildId, userId, options);

    let updated = null;
    await useLegacyStateMutation(state => {
        state.limitedAccounts ||= [];
        const record = state.limitedAccounts.find(item => item.guildId === guildId && item.userId === userId) || null;
        if (!record) return state;
        record.status = 'failed';
        record.restorationSource = options.source || 'limit_failed';
        record.updatedAt = options.updatedAt || Date.now();
        updated = record;
        return state;
    });
    return updated;
}

async function createModerationCase(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createModerationCase(await getSqliteDb(), record);
    let createdCase;

    await useLegacyStateMutation(state => {
        const id = Number(state.nextCaseId || 1);
        const timestamp = Date.now();
        createdCase = {
            id,
            guildId: record.guildId,
            type: record.type,
            userId: record.userId,
            userTag: record.userTag,
            moderatorId: record.moderatorId,
            moderatorTag: record.moderatorTag,
            reason: record.reason,
            duration: record.duration || null,
            active: record.active !== false,
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        state.nextCaseId = id + 1;
        state.cases.push(createdCase);
        return state;
    });

    return createdCase;
}

async function countActiveModerationCases(guildId, userId, type) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.countActiveModerationCases(await getSqliteDb(), guildId, userId, type);
    return (await readState()).cases
        .filter(item => item.guildId === guildId && item.userId === userId && item.type === type && item.active !== false)
        .length;
}

async function addUserHistory(record) {
    const createdAt = record.createdAt || Date.now();
    const settings = getHistorySettings();
    const entry = {
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        type: record.type,
        summary: record.summary,
        channelId: record.channelId || null,
        moderatorId: record.moderatorId || null,
        metadata: record.metadata || {},
        createdAt,
    };

    if (!shouldRecordHistoryEntry(entry, settings)) return null;

    const storage = getStorageSettings();
    if (storage.provider === 'sqlite') return repository.addUserHistory(await getSqliteDb(), entry, settings.maxEntries);

    await useLegacyStateMutation(state => {
        state.history.push(entry);
        state.history = state.history
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, settings.maxEntries);
        return state;
    });

    return entry;
}

async function addModNote(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.addModNote(await getSqliteDb(), record);
    const note = {
        id: makeId(),
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        moderatorId: record.moderatorId,
        moderatorTag: record.moderatorTag,
        note: record.note,
        createdAt: Date.now(),
    };

    await useLegacyStateMutation(state => {
        state.modNotes.push(note);
        state.modNotes = state.modNotes.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5000);
        return state;
    });

    return note;
}

async function listModNotes(guildId, userId, limit = 15) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listModNotes(await getSqliteDb(), guildId, userId, limit);
    return (await readState()).modNotes
        .filter(item => item.guildId === guildId && item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function deleteModNote(guildId, noteId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.deleteModNote(await getSqliteDb(), guildId, noteId);
    let deleted = null;

    await useLegacyStateMutation(state => {
        deleted = state.modNotes.find(item => item.guildId === guildId && item.id === noteId) || null;
        state.modNotes = state.modNotes.filter(item => !(item.guildId === guildId && item.id === noteId));
        return state;
    });

    return deleted;
}

async function listUserHistory(guildId, userId, limit = 15) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listUserHistory(await getSqliteDb(), guildId, userId, limit);
    return (await readState()).history
        .filter(item => item.guildId === guildId && item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function listGuildHistory(guildId, limit = 200) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listGuildHistory(await getSqliteDb(), guildId, limit);
    return (await readState()).history
        .filter(item => item.guildId === guildId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function recordCommandUsage(record) {
    const settings = getStorageSettings();
    const retention = getRetentionSettings();
    if (settings.provider === 'sqlite') return repository.recordCommandUsage(await getSqliteDb(), record, retention.commandUsageMaxEntries);
    const timestamp = Date.now();

    return useLegacyStateMutation(state => {
        state.commandStats.push({
            guildId: record.guildId || null,
            channelId: record.channelId || null,
            command: record.command,
            userId: record.userId,
            userTag: record.userTag,
            ok: record.ok === true,
            error: record.error || null,
            createdAt: timestamp,
        });
        state.commandStats = state.commandStats.sort((a, b) => b.createdAt - a.createdAt).slice(0, retention.commandUsageMaxEntries);
        return state;
    });
}

async function listCommandStats(guildId, since = 0) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listCommandStats(await getSqliteDb(), guildId, since);
    return (await readState()).commandStats
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !since || item.createdAt >= since)
        .sort((a, b) => b.createdAt - a.createdAt);
}

async function upsertTempVoiceChannel(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertTempVoiceChannel(await getSqliteDb(), record);
    return useLegacyStateMutation(state => {
        state.tempVoiceChannels = state.tempVoiceChannels.filter(item => item.channelId !== record.channelId);
        state.tempVoiceChannels.push(record);
        return state;
    });
}

async function removeTempVoiceChannel(channelId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.removeTempVoiceChannel(await getSqliteDb(), channelId);
    return useLegacyStateMutation(state => {
        state.tempVoiceChannels = state.tempVoiceChannels.filter(item => item.channelId !== channelId);
        return state;
    });
}

async function listTempVoiceChannelsForGuild(guildId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listTempVoiceChannelsForGuild(await getSqliteDb(), guildId);
    return (await readState()).tempVoiceChannels.filter(item => item.guildId === guildId);
}

async function getTempVoiceChannel(channelId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getTempVoiceChannel(await getSqliteDb(), channelId);
    return (await readState()).tempVoiceChannels.find(item => item.channelId === channelId) || null;
}

async function upsertTempRole(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertTempRole(await getSqliteDb(), record);
    return useLegacyStateMutation(state => {
        state.tempRoles = state.tempRoles.filter(item => !(item.guildId === record.guildId && item.userId === record.userId && item.roleId === record.roleId));
        state.tempRoles.push(record);
        return state;
    });
}

async function removeTempRole(guildId, userId, roleId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.removeTempRole(await getSqliteDb(), guildId, userId, roleId);
    return useLegacyStateMutation(state => {
        state.tempRoles = state.tempRoles.filter(item => !(item.guildId === guildId && item.userId === userId && item.roleId === roleId));
        return state;
    });
}

async function listExpiredTempRoles(timestamp = Date.now()) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listExpiredTempRoles(await getSqliteDb(), timestamp);
    return (await readState()).tempRoles.filter(record => record.expiresAt <= timestamp);
}

async function listExpiredTempBans(timestamp = Date.now()) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listExpiredTempBans(await getSqliteDb(), timestamp);
    return (await readState()).tempBans.filter(record => record.expiresAt <= timestamp);
}

async function listExpiredTempMutes(timestamp = Date.now()) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listExpiredTempMutes(await getSqliteDb(), timestamp);
    return (await readState()).tempMutes.filter(record => record.expiresAt <= timestamp);
}

async function appendVoiceActivity(record) {
    const settings = getStorageSettings();
    const retention = getRetentionSettings();
    if (settings.provider === 'sqlite') return repository.appendVoiceActivity(await getSqliteDb(), record, retention.voiceActivityMaxEntries);
    const entry = {
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        oldChannelId: record.oldChannelId || null,
        newChannelId: record.newChannelId || null,
        type: record.type,
        createdAt: Date.now(),
    };

    await useLegacyStateMutation(state => {
        state.voiceActivity.push(entry);
        state.voiceActivity = state.voiceActivity.sort((a, b) => b.createdAt - a.createdAt).slice(0, retention.voiceActivityMaxEntries);
        return state;
    });

    return entry;
}

async function listVoiceActivity(guildId, limit = 50) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listVoiceActivity(await getSqliteDb(), guildId, limit);
    return (await readState()).voiceActivity
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function getStarboardMessage(guildId, messageId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getStarboardMessage(await getSqliteDb(), guildId, messageId);
    return (await readState()).starboardMessages.find(item => item.guildId === guildId && item.messageId === messageId) || null;
}

async function upsertStarboardMessage(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertStarboardMessage(await getSqliteDb(), record);
    return useLegacyStateMutation(state => {
        const existing = state.starboardMessages.find(item => item.guildId === record.guildId && item.messageId === record.messageId);
        const entry = {
            ...(existing || {}),
            guildId: record.guildId,
            messageId: record.messageId,
            channelId: record.channelId,
            starboardChannelId: record.starboardChannelId,
            starboardMessageId: record.starboardMessageId,
            count: record.count,
            updatedAt: Date.now(),
            createdAt: existing?.createdAt || Date.now(),
        };
        state.starboardMessages = state.starboardMessages.filter(item => !(item.guildId === record.guildId && item.messageId === record.messageId));
        state.starboardMessages.push(entry);
        return state;
    });
}

async function addUserXp(guildId, userId, userTag, type, amount, cooldownMs = 0) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.addUserXp(await getSqliteDb(), guildId, userId, userTag, type, amount, cooldownMs);
    let updated;
    const timestamp = Date.now();

    await useLegacyStateMutation(state => {
        let record = state.levels.find(item => item.guildId === guildId && item.userId === userId);
        if (!record) {
            record = {
                guildId,
                userId,
                userTag,
                textXp: 0,
                voiceXp: 0,
                lastTextXpAt: 0,
                updatedAt: timestamp,
            };
            state.levels.push(record);
        }

        if (type === 'text' && cooldownMs && timestamp - Number(record.lastTextXpAt || 0) < cooldownMs) {
            updated = record;
            return state;
        }

        if (type === 'text') {
            record.textXp += amount;
            record.lastTextXpAt = timestamp;
        } else {
            record.voiceXp += amount;
        }

        record.userTag = userTag;
        record.updatedAt = timestamp;
        updated = record;
        return state;
    });

    return updated;
}

async function getUserLevelRecord(guildId, userId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getUserLevelRecord(await getSqliteDb(), guildId, userId);
    return (await readState()).levels.find(item => item.guildId === guildId && item.userId === userId) || null;
}

function levelScore(record, mode = 'total') {
    if (!record) return 0;
    if (mode === 'text') return Number(record.textXp || 0);
    if (mode === 'voice') return Number(record.voiceXp || 0);
    return Number(record.textXp || 0) + Number(record.voiceXp || 0);
}

function normalizeLevelRecord(record, timestamp = Date.now()) {
    return {
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag || null,
        textXp: Math.max(0, Math.floor(Number(record.textXp || 0))),
        voiceXp: Math.max(0, Math.floor(Number(record.voiceXp || 0))),
        lastTextXpAt: Number(record.lastTextXpAt || 0),
        createdAt: record.createdAt || timestamp,
        updatedAt: record.updatedAt || timestamp,
    };
}

async function listLevelLeaderboard(guildId, limit = 10, mode = 'total', offset = 0) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelLeaderboard(await getSqliteDb(), guildId, limit, mode, offset);

    return (await readState()).levels
        .filter(item => item.guildId === guildId)
        .filter(item => levelScore(item, mode) > 0)
        .sort((a, b) => levelScore(b, mode) - levelScore(a, mode) || String(a.userId).localeCompare(String(b.userId)))
        .slice(Math.max(0, Number(offset || 0)), Math.max(0, Number(offset || 0)) + limit);
}

async function getLevelRank(guildId, userId, mode = 'total') {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelRank(await getSqliteDb(), guildId, userId, mode);
    const state = await readState();
    const record = state.levels.find(item => item.guildId === guildId && item.userId === userId);
    const score = levelScore(record, mode);
    if (!record || score <= 0) return null;
    return state.levels
        .filter(item => item.guildId === guildId)
        .filter(item => levelScore(item, mode) > score || (levelScore(item, mode) === score && String(item.userId).localeCompare(String(userId)) < 0))
        .length + 1;
}

async function insertLevelXpEvent(event) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.insertLevelXpEvent(await getSqliteDb(), event);
    const timestamp = event.createdAt || Date.now();
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelXpEvents ||= [];
        if (event.sourceKey && state.levelXpEvents.some(item => item.guildId === event.guildId && item.source === event.source && item.sourceKey === event.sourceKey)) {
            return state;
        }
        saved = {
            id: state.levelXpEvents.length + 1,
            guildId: event.guildId,
            userId: event.userId,
            userTag: event.userTag || null,
            source: event.source,
            sourceKey: event.sourceKey || null,
            xpType: event.xpType || 'text',
            amount: Number(event.amount || 0),
            previousTextXp: Number(event.previousTextXp || 0),
            previousVoiceXp: Number(event.previousVoiceXp || 0),
            newTextXp: Number(event.newTextXp || 0),
            newVoiceXp: Number(event.newVoiceXp || 0),
            adminId: event.adminId || null,
            jobId: event.jobId || null,
            metadata: event.metadata || {},
            createdAt: timestamp,
        };
        state.levelXpEvents.push(saved);
        return state;
    });
    return saved;
}

async function adjustUserXp(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.adjustUserXp(await getSqliteDb(), record);
    const timestamp = record.createdAt || Date.now();
    let updated = null;
    await useLegacyStateMutation(state => {
        state.levels ||= [];
        let current = state.levels.find(item => item.guildId === record.guildId && item.userId === record.userId);
        if (!current) {
            current = normalizeLevelRecord({ guildId: record.guildId, userId: record.userId, userTag: record.userTag }, timestamp);
            state.levels.push(current);
        }
        const previous = { ...current };
        const amount = Math.trunc(Number(record.amount || 0));
        const xpType = record.xpType === 'voice' ? 'voice' : 'text';
        if (xpType === 'voice') current.voiceXp = Math.max(0, Number(current.voiceXp || 0) + amount);
        else current.textXp = Math.max(0, Number(current.textXp || 0) + amount);
        current.userTag = record.userTag || current.userTag;
        current.updatedAt = timestamp;
        state.levelXpEvents ||= [];
        if (!record.sourceKey || !state.levelXpEvents.some(item => item.guildId === record.guildId && item.source === (record.source || 'adjustment') && item.sourceKey === record.sourceKey)) {
            state.levelXpEvents.push({
                id: state.levelXpEvents.length + 1,
                guildId: record.guildId,
                userId: record.userId,
                userTag: current.userTag,
                source: record.source || 'adjustment',
                sourceKey: record.sourceKey || null,
                xpType,
                amount,
                previousTextXp: previous.textXp,
                previousVoiceXp: previous.voiceXp,
                newTextXp: current.textXp,
                newVoiceXp: current.voiceXp,
                adminId: record.adminId || null,
                jobId: record.jobId || null,
                metadata: record.metadata || {},
                createdAt: timestamp,
            });
        }
        updated = { ...current };
        return state;
    });
    return updated;
}

async function setUserXp(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.setUserXp(await getSqliteDb(), record);
    const timestamp = record.createdAt || Date.now();
    let updated = null;
    await useLegacyStateMutation(state => {
        state.levels ||= [];
        let current = state.levels.find(item => item.guildId === record.guildId && item.userId === record.userId);
        if (!current) {
            current = normalizeLevelRecord({ guildId: record.guildId, userId: record.userId, userTag: record.userTag }, timestamp);
            state.levels.push(current);
        }
        const previous = { ...current };
        current.textXp = Math.max(0, Math.floor(Number(record.textXp ?? current.textXp ?? 0)));
        current.voiceXp = Math.max(0, Math.floor(Number(record.voiceXp ?? current.voiceXp ?? 0)));
        current.lastTextXpAt = Number(record.lastTextXpAt ?? current.lastTextXpAt ?? 0);
        current.userTag = record.userTag || current.userTag;
        current.updatedAt = timestamp;
        state.levelXpEvents ||= [];
        state.levelXpEvents.push({
            id: state.levelXpEvents.length + 1,
            guildId: record.guildId,
            userId: record.userId,
            userTag: current.userTag,
            source: record.source || 'set',
            sourceKey: record.sourceKey || null,
            xpType: record.xpType || 'combined',
            amount: levelScore(current) - levelScore(previous),
            previousTextXp: previous.textXp,
            previousVoiceXp: previous.voiceXp,
            newTextXp: current.textXp,
            newVoiceXp: current.voiceXp,
            adminId: record.adminId || null,
            jobId: record.jobId || null,
            metadata: record.metadata || {},
            createdAt: timestamp,
        });
        updated = { ...current };
        return state;
    });
    return updated;
}

async function setUserXpMinimum(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.setUserXpMinimum(await getSqliteDb(), record);
    const current = await getUserLevelRecord(record.guildId, record.userId);
    if (levelScore(current) >= Number(record.minimumTotalXp || 0)) return current;
    return setUserXp({
        ...record,
        textXp: Math.max(0, Math.floor(Number(record.minimumTotalXp || 0))),
        voiceXp: 0,
        source: record.source || 'minimum',
    });
}

async function listLevelXpEvents(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelXpEvents(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 100));
    return ((await readState()).levelXpEvents || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !options.userId || item.userId === options.userId)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, limit);
}

async function createLevelImportJob(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createLevelImportJob(await getSqliteDb(), record);
    const timestamp = Date.now();
    let result = null;
    await useLegacyStateMutation(state => {
        state.levelImportJobs ||= [];
        const active = state.levelImportJobs.find(item => item.guildId === record.guildId && ['queued', 'running', 'cancelling'].includes(item.status));
        if (active) {
            result = { ok: false, job: active, reason: 'active_job' };
            return state;
        }
        const job = {
            id: record.id || makeId(),
            guildId: record.guildId,
            targetUserId: record.targetUserId || null,
            status: record.status || 'queued',
            dryRun: record.dryRun !== false,
            profileHash: record.profileHash,
            profile: record.profile || {},
            createdBy: record.createdBy || null,
            createdAt: record.createdAt || timestamp,
            updatedAt: timestamp,
            startedAt: null,
            completedAt: null,
            currentChannelId: null,
            channelsTotal: 0,
            channelsScanned: 0,
            messagesSeen: 0,
            messagesEligible: 0,
            membersSeen: 0,
            xpEstimated: 0,
            xpApplied: 0,
            skippedChannels: [],
            errors: [],
            cancelRequested: false,
            provenance: record.provenance || {},
            result: {},
        };
        state.levelImportJobs.push(job);
        result = { ok: true, job };
        return state;
    });
    return result;
}

async function getLevelImportJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelImportJob(await getSqliteDb(), id);
    return ((await readState()).levelImportJobs || []).find(item => item.id === id) || null;
}

async function listLevelImportJobs(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelImportJobs(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 50));
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return ((await readState()).levelImportJobs || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !statuses || statuses.has(item.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}

async function updateLevelImportJob(id, patch = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateLevelImportJob(await getSqliteDb(), id, patch);
    let updated = null;
    await useLegacyStateMutation(state => {
        const job = (state.levelImportJobs || []).find(item => item.id === id);
        if (!job) return state;
        Object.assign(job, patch, { updatedAt: patch.updatedAt || Date.now() });
        updated = { ...job };
        return state;
    });
    return updated;
}

async function requestCancelLevelImportJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.requestCancelLevelImportJob(await getSqliteDb(), id);
    const job = await getLevelImportJob(id);
    if (!job) return null;
    return updateLevelImportJob(id, {
        status: ['completed', 'cancelled', 'failed', 'needs_confirmation'].includes(job.status) ? job.status : 'cancelling',
        cancelRequested: true,
    });
}

async function createLevelCalibrationJob(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createLevelCalibrationJob(await getSqliteDb(), record);
    const timestamp = Date.now();
    let result = null;
    await useLegacyStateMutation(state => {
        state.levelCalibrationJobs ||= [];
        const active = state.levelCalibrationJobs.find(item => (
            item.guildId === record.guildId
            && item.importJobId === record.importJobId
            && ['queued', 'running', 'cancelling'].includes(item.status)
        ));
        if (active) {
            result = { ok: false, job: active, reason: 'active_job' };
            return state;
        }
        const job = {
            id: record.id || makeId(),
            guildId: record.guildId,
            importJobId: record.importJobId,
            kind: record.kind || 'preview',
            status: record.status || 'queued',
            createdBy: record.createdBy || null,
            createdAt: record.createdAt || timestamp,
            updatedAt: timestamp,
            startedAt: null,
            completedAt: null,
            profile: record.profile || {},
            options: record.options || {},
            progress: record.progress || {},
            result: record.result || {},
            error: null,
            cancelRequested: false,
        };
        state.levelCalibrationJobs.push(job);
        result = { ok: true, job };
        return state;
    });
    return result;
}

async function getLevelCalibrationJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelCalibrationJob(await getSqliteDb(), id);
    return ((await readState()).levelCalibrationJobs || []).find(item => item.id === id) || null;
}

async function listLevelCalibrationJobs(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelCalibrationJobs(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 50));
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return ((await readState()).levelCalibrationJobs || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !options.importJobId || item.importJobId === options.importJobId)
        .filter(item => !statuses || statuses.has(item.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}

async function updateLevelCalibrationJob(id, patch = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateLevelCalibrationJob(await getSqliteDb(), id, patch);
    let updated = null;
    await useLegacyStateMutation(state => {
        const job = (state.levelCalibrationJobs || []).find(item => item.id === id);
        if (!job) return state;
        Object.assign(job, patch, { updatedAt: patch.updatedAt || Date.now() });
        updated = { ...job };
        return state;
    });
    return updated;
}

async function requestCancelLevelCalibrationJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.requestCancelLevelCalibrationJob(await getSqliteDb(), id);
    const job = await getLevelCalibrationJob(id);
    if (!job) return null;
    return updateLevelCalibrationJob(id, {
        status: ['completed', 'cancelled', 'failed'].includes(job.status) ? job.status : 'cancelling',
        cancelRequested: true,
    });
}

async function createLevelProbotScanJob(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createLevelProbotScanJob(await getSqliteDb(), record);
    const timestamp = Date.now();
    let result = null;
    await useLegacyStateMutation(state => {
        state.levelProbotScanJobs ||= [];
        const active = state.levelProbotScanJobs.find(item => (
            item.guildId === record.guildId
            && item.sourceChannelId === record.sourceChannelId
            && ['queued', 'running', 'cancelling'].includes(item.status)
        ));
        if (active) {
            result = { ok: false, job: active, reason: 'active_job' };
            return state;
        }
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
            updatedAt: timestamp,
            startedAt: null,
            completedAt: null,
            currentChannelId: null,
            channelsTotal: sourceChannelIds.length,
            channelsScanned: 0,
            scannedCount: 0,
            matchedCount: 0,
            verifiedCount: 0,
            unresolvedCount: 0,
            invalidCount: 0,
            skippedCount: 0,
            duplicateCount: 0,
            oldestScannedAt: null,
            newestScannedAt: null,
            errors: [],
            cancelRequested: false,
            result: record.result || {},
        };
        state.levelProbotScanJobs.push(job);
        result = { ok: true, job };
        return state;
    });
    return result;
}

async function getLevelProbotScanJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelProbotScanJob(await getSqliteDb(), id);
    return ((await readState()).levelProbotScanJobs || []).find(item => item.id === id) || null;
}

async function listLevelProbotScanJobs(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProbotScanJobs(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 50));
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return ((await readState()).levelProbotScanJobs || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !statuses || statuses.has(item.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}

async function updateLevelProbotScanJob(id, patch = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateLevelProbotScanJob(await getSqliteDb(), id, patch);
    let updated = null;
    await useLegacyStateMutation(state => {
        const job = (state.levelProbotScanJobs || []).find(item => item.id === id);
        if (!job) return state;
        Object.assign(job, patch, { updatedAt: patch.updatedAt || Date.now() });
        updated = { ...job };
        return state;
    });
    return updated;
}

async function requestCancelLevelProbotScanJob(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.requestCancelLevelProbotScanJob(await getSqliteDb(), id);
    const job = await getLevelProbotScanJob(id);
    if (!job) return null;
    return updateLevelProbotScanJob(id, {
        status: ['completed', 'cancelled', 'failed'].includes(job.status) ? job.status : 'cancelling',
        cancelRequested: true,
    });
}

async function upsertLevelProbotScanCheckpoint(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertLevelProbotScanCheckpoint(await getSqliteDb(), record);
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelProbotScanCheckpoints ||= [];
        saved = {
            jobId: record.jobId,
            guildId: record.guildId,
            channelId: record.channelId,
            parentChannelId: record.parentChannelId || null,
            beforeMessageId: record.beforeMessageId || null,
            oldestMessageId: record.oldestMessageId || null,
            status: record.status || 'pending',
            scannedCount: Number(record.scannedCount || 0),
            matchedCount: Number(record.matchedCount || 0),
            verifiedCount: Number(record.verifiedCount || 0),
            unresolvedCount: Number(record.unresolvedCount || 0),
            invalidCount: Number(record.invalidCount || 0),
            skippedCount: Number(record.skippedCount || 0),
            duplicateCount: Number(record.duplicateCount || 0),
            oldestScannedAt: record.oldestScannedAt || null,
            newestScannedAt: record.newestScannedAt || null,
            error: record.error || null,
            updatedAt: record.updatedAt || Date.now(),
        };
        state.levelProbotScanCheckpoints = state.levelProbotScanCheckpoints.filter(item => !(item.jobId === saved.jobId && item.channelId === saved.channelId));
        state.levelProbotScanCheckpoints.push(saved);
        return state;
    });
    return saved;
}

async function listLevelProbotScanCheckpoints(jobId = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProbotScanCheckpoints(await getSqliteDb(), jobId);
    return ((await readState()).levelProbotScanCheckpoints || [])
        .filter(item => !jobId || item.jobId === jobId)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function insertLevelProbotAnnouncement(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.insertLevelProbotAnnouncement(await getSqliteDb(), record);
    let result = null;
    await useLegacyStateMutation(state => {
        state.levelProbotAnnouncements ||= [];
        const existing = state.levelProbotAnnouncements.find(item => item.guildId === record.guildId && item.messageId === record.messageId);
        if (existing) {
            result = { inserted: false, repeated: existing.parseStatus === 'repeated_verified', record: existing };
            return state;
        }
        const repeated = record.parseStatus === 'verified'
            && record.targetUserId
            && state.levelProbotAnnouncements.some(item => (
                item.guildId === record.guildId
                && item.targetUserId === record.targetUserId
                && Number(item.announcedLevel || 0) === Number(record.announcedLevel || 0)
                && ['verified', 'repeated_verified'].includes(item.parseStatus)
            ));
        const saved = {
            guildId: record.guildId,
            sourceChannelId: record.sourceChannelId,
            messageId: record.messageId,
            jobId: record.jobId || null,
            probotAuthorId: record.probotAuthorId,
            targetUserId: record.targetUserId || null,
            announcedLevel: record.announcedLevel === null || record.announcedLevel === undefined ? null : Number(record.announcedLevel),
            announcementTimestamp: Number(record.announcementTimestamp || 0),
            parserVersion: record.parserVersion,
            parseStatus: repeated ? 'repeated_verified' : record.parseStatus,
            confidence: record.confidence || 'none',
            contentSource: record.contentSource || null,
            diagnostic: record.diagnostic || {},
            createdAt: record.createdAt || Date.now(),
        };
        state.levelProbotAnnouncements.push(saved);
        result = { inserted: true, repeated, record: saved };
        return state;
    });
    return result;
}

async function listLevelProbotAnnouncements(guildId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProbotAnnouncements(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 1000));
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return ((await readState()).levelProbotAnnouncements || [])
        .filter(item => item.guildId === guildId)
        .filter(item => !options.userId || item.targetUserId === options.userId)
        .filter(item => !statuses || statuses.has(item.parseStatus))
        .sort((a, b) => Number(b.announcementTimestamp || 0) - Number(a.announcementTimestamp || 0))
        .slice(0, limit);
}

async function listHighestProbotAnnouncementLevels(guildId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listHighestProbotAnnouncementLevels(await getSqliteDb(), guildId, options);
    const userFilter = Array.isArray(options.userIds) && options.userIds.length ? new Set(options.userIds.map(String)) : null;
    const byUser = new Map();
    for (const item of ((await readState()).levelProbotAnnouncements || [])) {
        if (item.guildId !== guildId || !item.targetUserId || !['verified', 'repeated_verified'].includes(item.parseStatus)) continue;
        if (userFilter && !userFilter.has(String(item.targetUserId))) continue;
        const current = byUser.get(item.targetUserId) || {
            guildId,
            userId: item.targetUserId,
            announcementLevel: 0,
            announcementCount: 0,
            firstAnnouncementAt: Number(item.announcementTimestamp || 0),
            lastAnnouncementAt: Number(item.announcementTimestamp || 0),
        };
        current.announcementLevel = Math.max(current.announcementLevel, Number(item.announcedLevel || 0));
        current.announcementCount += 1;
        current.firstAnnouncementAt = Math.min(current.firstAnnouncementAt, Number(item.announcementTimestamp || 0));
        current.lastAnnouncementAt = Math.max(current.lastAnnouncementAt, Number(item.announcementTimestamp || 0));
        byUser.set(item.targetUserId, current);
    }
    return [...byUser.values()].sort((a, b) => b.announcementLevel - a.announcementLevel || String(a.userId).localeCompare(String(b.userId)));
}

async function summarizeProbotAnnouncementEvidence(guildId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.summarizeProbotAnnouncementEvidence(await getSqliteDb(), guildId);
    const records = (await readState()).levelProbotAnnouncements || [];
    const guildRecords = records.filter(item => item.guildId === guildId);
    const verified = guildRecords.filter(item => ['verified', 'repeated_verified'].includes(item.parseStatus));
    return {
        totalRecords: guildRecords.length,
        verifiedAnnouncements: verified.length,
        uniqueVerifiedMembers: new Set(verified.map(item => item.targetUserId).filter(Boolean)).size,
        unresolvedIdentities: guildRecords.filter(item => item.parseStatus === 'unresolved_identity').length,
        invalidRecords: guildRecords.filter(item => !['verified', 'repeated_verified', 'unresolved_identity'].includes(item.parseStatus)).length,
        repeatedAnnouncements: guildRecords.filter(item => item.parseStatus === 'repeated_verified').length,
        highestRecoveredLevel: verified.reduce((highest, item) => Math.max(highest, Number(item.announcedLevel || 0)), 0),
    };
}

async function applyLevelProbotFinalMigration(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.applyLevelProbotFinalMigration(await getSqliteDb(), record);
    throw new Error('Final ProBot XP migration requires SQLite storage.');
}

async function rollbackLevelProbotFinalMigration(batchId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.rollbackLevelProbotFinalMigration(await getSqliteDb(), batchId, options);
    throw new Error('Final ProBot XP migration rollback requires SQLite storage.');
}

async function getLevelProbotMigrationBatch(batchId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelProbotMigrationBatch(await getSqliteDb(), batchId);
    return ((await readState()).levelProbotMigrationBatches || []).find(item => item.id === batchId) || null;
}

async function listLevelProbotMigrationBatches(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProbotMigrationBatches(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 50));
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return ((await readState()).levelProbotMigrationBatches || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !statuses || statuses.has(item.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}

async function listLevelProbotMigrationSnapshots(batchId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProbotMigrationSnapshots(await getSqliteDb(), batchId, options);
    const limit = Math.max(1, Number(options.limit || 10000));
    return ((await readState()).levelProbotMigrationSnapshots || [])
        .filter(item => !batchId || item.batchId === batchId)
        .filter(item => !options.guildId || item.guildId === options.guildId)
        .filter(item => !options.userId || item.userId === options.userId)
        .sort((a, b) => Number(b.appliedAt || 0) - Number(a.appliedAt || 0))
        .slice(0, limit);
}

async function upsertLevelImportCheckpoint(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertLevelImportCheckpoint(await getSqliteDb(), record);
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelImportCheckpoints ||= [];
        const timestamp = record.updatedAt || Date.now();
        saved = {
            jobId: record.jobId,
            guildId: record.guildId,
            channelId: record.channelId,
            parentChannelId: record.parentChannelId || null,
            beforeMessageId: record.beforeMessageId || null,
            oldestMessageId: record.oldestMessageId || null,
            status: record.status || 'pending',
            messagesSeen: Number(record.messagesSeen || 0),
            messagesEligible: Number(record.messagesEligible || 0),
            error: record.error || null,
            updatedAt: timestamp,
        };
        state.levelImportCheckpoints = state.levelImportCheckpoints.filter(item => !(item.jobId === saved.jobId && item.channelId === saved.channelId));
        state.levelImportCheckpoints.push(saved);
        return state;
    });
    return saved;
}

async function listLevelImportCheckpoints(jobId = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelImportCheckpoints(await getSqliteDb(), jobId);
    return ((await readState()).levelImportCheckpoints || [])
        .filter(item => !jobId || item.jobId === jobId)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function insertLevelImportMessage(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.insertLevelImportMessage(await getSqliteDb(), record);
    let inserted = false;
    await useLegacyStateMutation(state => {
        state.levelImportMessages ||= [];
        if (state.levelImportMessages.some(item => item.jobId === record.jobId && item.messageId === record.messageId)) return state;
        state.levelImportMessages.push({
            jobId: record.jobId,
            guildId: record.guildId,
            messageId: record.messageId,
            userId: record.userId,
            userTag: record.userTag || null,
            channelId: record.channelId,
            createdAt: Number(record.createdAt || 0),
            xpAmount: Number(record.xpAmount || 0),
            eligible: record.eligible !== false,
            skipReason: record.skipReason || null,
        });
        inserted = true;
        return state;
    });
    return inserted;
}

async function listLevelImportMessages(jobId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelImportMessages(await getSqliteDb(), jobId, options);
    const limit = Math.max(1, Number(options.limit || 10000));
    return ((await readState()).levelImportMessages || [])
        .filter(item => !jobId || item.jobId === jobId)
        .filter(item => !options.userId || item.userId === options.userId)
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.messageId).localeCompare(String(b.messageId)))
        .slice(0, limit);
}

async function listLevelImportMessagesPage(jobId, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelImportMessagesPage(await getSqliteDb(), jobId, options);
    const requestedLimit = Number(options.limit || 1000);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10000, Math.floor(requestedLimit))) : 1000;
    const afterCreatedAt = options.afterCreatedAt === undefined ? null : Number(options.afterCreatedAt);
    const afterMessageId = options.afterMessageId || '';
    return ((await readState()).levelImportMessages || [])
        .filter(item => item.jobId === jobId)
        .filter(item => !options.userId || item.userId === options.userId)
        .filter(item => afterCreatedAt === null
            || Number(item.createdAt || 0) > afterCreatedAt
            || (Number(item.createdAt || 0) === afterCreatedAt && String(item.messageId).localeCompare(afterMessageId) > 0))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.messageId).localeCompare(String(b.messageId)))
        .slice(0, limit);
}

async function countProcessedLevelMessage(guildId, messageId, profileHash) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.countProcessedLevelMessage(await getSqliteDb(), guildId, messageId, profileHash);
    return ((await readState()).levelProcessedMessages || [])
        .filter(item => item.guildId === guildId && item.messageId === messageId && item.profileHash === profileHash)
        .length;
}

async function markLevelImportMessageProcessed(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.markLevelImportMessageProcessed(await getSqliteDb(), record);
    let inserted = false;
    await useLegacyStateMutation(state => {
        state.levelProcessedMessages ||= [];
        if (state.levelProcessedMessages.some(item => item.guildId === record.guildId && item.messageId === record.messageId && item.profileHash === record.profileHash)) return state;
        state.levelProcessedMessages.push({
            guildId: record.guildId,
            messageId: record.messageId,
            profileHash: record.profileHash,
            jobId: record.jobId,
            userId: record.userId,
            channelId: record.channelId,
            xpAmount: Number(record.xpAmount || 0),
            createdAt: record.createdAt || Date.now(),
        });
        inserted = true;
        return state;
    });
    return inserted;
}

async function listLevelProcessedMessages(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelProcessedMessages(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 10000));
    return ((await readState()).levelProcessedMessages || [])
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, limit);
}

async function upsertLevelRoleMapping(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertLevelRoleMapping(await getSqliteDb(), record);
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelRoleMappings ||= [];
        const timestamp = Date.now();
        saved = {
            guildId: record.guildId,
            roleId: record.roleId,
            minimumLevel: Number(record.minimumLevel || 0),
            createdBy: record.createdBy || null,
            createdAt: record.createdAt || timestamp,
            updatedAt: timestamp,
        };
        state.levelRoleMappings = state.levelRoleMappings.filter(item => !(item.guildId === saved.guildId && item.roleId === saved.roleId));
        state.levelRoleMappings.push(saved);
        return state;
    });
    return saved;
}

async function removeLevelRoleMapping(guildId, roleId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.removeLevelRoleMapping(await getSqliteDb(), guildId, roleId);
    let changes = 0;
    await useLegacyStateMutation(state => {
        const before = (state.levelRoleMappings || []).length;
        state.levelRoleMappings = (state.levelRoleMappings || []).filter(item => !(item.guildId === guildId && item.roleId === roleId));
        changes = before - state.levelRoleMappings.length;
        return state;
    });
    return changes;
}

async function listLevelRoleMappings(guildId = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelRoleMappings(await getSqliteDb(), guildId);
    return ((await readState()).levelRoleMappings || [])
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => Number(a.minimumLevel || 0) - Number(b.minimumLevel || 0) || String(a.roleId).localeCompare(String(b.roleId)));
}

async function insertLevelReconciliationRecord(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.insertLevelReconciliationRecord(await getSqliteDb(), record);
    const timestamp = record.createdAt || Date.now();
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelReconciliationRecords ||= [];
        saved = {
            id: state.levelReconciliationRecords.length + 1,
            jobId: record.jobId || null,
            guildId: record.guildId,
            userId: record.userId,
            userTag: record.userTag || null,
            existingXp: Number(record.existingXp || 0),
            messageEstimatedXp: Number(record.messageEstimatedXp || 0),
            messageEstimatedLevel: Number(record.messageEstimatedLevel || 0),
            roleMinLevel: Number(record.roleMinLevel || 0),
            roleMinXp: Number(record.roleMinXp || 0),
            finalXp: Number(record.finalXp || 0),
            policy: record.policy || 'max',
            dryRun: record.dryRun !== false,
            applied: record.applied === true,
            metadata: record.metadata || {},
            createdAt: timestamp,
        };
        state.levelReconciliationRecords.push(saved);
        return state;
    });
    return saved;
}

async function listLevelReconciliationRecords(jobId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelReconciliationRecords(await getSqliteDb(), jobId, options);
    const limit = Math.max(1, Number(options.limit || 100));
    return ((await readState()).levelReconciliationRecords || [])
        .filter(item => !jobId || item.jobId === jobId)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, limit);
}

async function createLevelTestSession(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createLevelTestSession(await getSqliteDb(), record);
    const timestamp = Date.now();
    let saved = null;
    await useLegacyStateMutation(state => {
        state.levelTestSessions ||= [];
        saved = {
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
            createdAt: record.createdAt || timestamp,
            updatedAt: timestamp,
            rolledBackAt: null,
        };
        state.levelTestSessions.push(saved);
        return state;
    });
    return saved;
}

async function getLevelTestSession(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getLevelTestSession(await getSqliteDb(), id);
    return ((await readState()).levelTestSessions || []).find(item => item.id === id) || null;
}

async function listLevelTestSessions(guildId = null, options = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelTestSessions(await getSqliteDb(), guildId, options);
    const limit = Math.max(1, Number(options.limit || 50));
    return ((await readState()).levelTestSessions || [])
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !options.userId || item.userId === options.userId)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, limit);
}

async function updateLevelTestSession(id, patch = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateLevelTestSession(await getSqliteDb(), id, patch);
    let updated = null;
    await useLegacyStateMutation(state => {
        const session = (state.levelTestSessions || []).find(item => item.id === id);
        if (!session) return state;
        Object.assign(session, patch, { updatedAt: patch.updatedAt || Date.now() });
        updated = { ...session };
        return state;
    });
    return updated;
}

async function createScheduledMessage(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createScheduledMessage(await getSqliteDb(), record);
    const timestamp = Date.now();
    const entry = {
        id: makeId(),
        guildId: record.guildId,
        channelId: record.channelId,
        content: record.content || '',
        embed: record.embed || null,
        createdBy: record.createdBy || null,
        createdAt: timestamp,
        scheduledFor: Number(record.scheduledFor),
        sentAt: null,
        status: 'pending',
        error: null,
    };

    await useLegacyStateMutation(state => {
        state.scheduledMessages.push(entry);
        state.scheduledMessages = state.scheduledMessages
            .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
            .slice(-1000);
        return state;
    });

    return entry;
}

async function upsertEmbedTemplate(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertEmbedTemplate(await getSqliteDb(), record);
    const timestamp = Date.now();
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

    await useLegacyStateMutation(state => {
        state.embedTemplates = state.embedTemplates.filter(item => !(item.guildId === template.guildId && item.id === template.id));
        state.embedTemplates.push(template);
        state.embedTemplates = state.embedTemplates.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
        return state;
    });

    return template;
}

async function listEmbedTemplates(guildId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listEmbedTemplates(await getSqliteDb(), guildId);
    return (await readState()).embedTemplates
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function deleteEmbedTemplate(guildId, id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.deleteEmbedTemplate(await getSqliteDb(), guildId, id);
    let deleted = null;

    await useLegacyStateMutation(state => {
        deleted = state.embedTemplates.find(item => item.guildId === guildId && item.id === id) || null;
        state.embedTemplates = state.embedTemplates.filter(item => !(item.guildId === guildId && item.id === id));
        return state;
    });

    return deleted;
}

async function listScheduledMessages(guildId, limit = 50) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listScheduledMessages(await getSqliteDb(), guildId, limit);
    return (await readState()).scheduledMessages
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
        .slice(0, limit);
}

async function listDueScheduledMessages(timestamp = Date.now(), limit = 25) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listDueScheduledMessages(await getSqliteDb(), timestamp, limit);
    return (await readState()).scheduledMessages
        .filter(item => item.status === 'pending' && Number(item.scheduledFor) <= timestamp)
        .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
        .slice(0, limit);
}

async function updateScheduledMessageStatus(id, status, error = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateScheduledMessageStatus(await getSqliteDb(), id, status, error);
    let updated = null;

    await useLegacyStateMutation(state => {
        const record = state.scheduledMessages.find(item => item.id === id);
        if (!record) return state;

        record.status = status;
        record.error = error;
        record.sentAt = status === 'sent' ? Date.now() : record.sentAt;
        updated = record;
        return state;
    });

    return updated;
}

async function deleteScheduledMessage(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.deleteScheduledMessage(await getSqliteDb(), id);
    let deleted = null;

    await useLegacyStateMutation(state => {
        deleted = state.scheduledMessages.find(item => item.id === id) || null;
        state.scheduledMessages = state.scheduledMessages.filter(item => item.id !== id);
        return state;
    });

    return deleted;
}

async function upsertTicketRecord(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.upsertTicketRecord(await getSqliteDb(), record);
    const timestamp = Date.now();
    let updated = null;

    await useLegacyStateMutation(state => {
        const existing = state.ticketRecords.find(item => item.channelId === record.channelId);
        updated = {
            ...(existing || {}),
            guildId: record.guildId || existing?.guildId,
            channelId: record.channelId,
            openerId: record.openerId || existing?.openerId || null,
            openerTag: record.openerTag || existing?.openerTag || null,
            claimedById: record.claimedById !== undefined ? record.claimedById : existing?.claimedById || null,
            claimedByTag: record.claimedByTag !== undefined ? record.claimedByTag : existing?.claimedByTag || null,
            priority: record.priority || existing?.priority || 'normal',
            tags: record.tags || existing?.tags || [],
            status: record.status || existing?.status || 'open',
            lastActivityAt: record.lastActivityAt || existing?.lastActivityAt || timestamp,
            createdAt: existing?.createdAt || record.createdAt || timestamp,
            updatedAt: timestamp,
        };
        state.ticketRecords = state.ticketRecords.filter(item => item.channelId !== record.channelId);
        state.ticketRecords.push(updated);
        return state;
    });

    return updated;
}

async function getTicketRecord(channelId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getTicketRecord(await getSqliteDb(), channelId);
    return (await readState()).ticketRecords.find(item => item.channelId === channelId) || null;
}

async function listTicketRecords(guildId, limit = 100) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listTicketRecords(await getSqliteDb(), guildId, limit);
    return (await readState()).ticketRecords
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}

async function deleteTicketRecord(channelId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.deleteTicketRecord(await getSqliteDb(), channelId);
    return useLegacyStateMutation(state => {
        state.ticketRecords = state.ticketRecords.filter(item => item.channelId !== channelId);
        return state;
    });
}

async function createTicketTranscript(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createTicketTranscript(await getSqliteDb(), record);
    const timestamp = Date.now();
    const transcript = {
        id: record.id || makeId(),
        guildId: record.guildId,
        channelId: record.channelId,
        channelName: record.channelName || record.channelId,
        ticketName: record.ticketName || record.channelName || record.channelId,
        openerId: record.openerId || null,
        createdBy: record.createdBy || null,
        createdAt: timestamp,
        messageCount: Number(record.messageCount || 0),
        allowedUserIds: [...new Set((record.allowedUserIds || []).filter(Boolean))],
        html: record.html || '',
        text: record.text || '',
    };

    await useLegacyStateMutation(state => {
        state.ticketTranscripts.push(transcript);
        state.ticketTranscripts = state.ticketTranscripts
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 1000);
        return state;
    });

    return transcript;
}

async function getTicketTranscript(id) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getTicketTranscript(await getSqliteDb(), id);
    return (await readState()).ticketTranscripts.find(item => item.id === id) || null;
}

async function listTicketTranscripts(guildId, limit = 50) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listTicketTranscripts(await getSqliteDb(), guildId, limit);
    return (await readState()).ticketTranscripts
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function getModerationCase(guildId, caseId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.getModerationCase(await getSqliteDb(), guildId, caseId);
    return (await readState()).cases.find(item => item.guildId === guildId && item.id === Number(caseId)) || null;
}

async function listModerationCases(guildId, filters = {}) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listModerationCases(await getSqliteDb(), guildId, filters);
    const state = await readState();
    return state.cases
        .filter(item => item.guildId === guildId)
        .filter(item => !filters.userId || item.userId === filters.userId)
        .filter(item => !filters.type || item.type === filters.type)
        .sort((a, b) => b.id - a.id);
}

async function updateModerationCaseReason(guildId, caseId, reason) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateModerationCaseReason(await getSqliteDb(), guildId, caseId, reason);
    let updatedCase = null;

    await useLegacyStateMutation(state => {
        const record = state.cases.find(item => item.guildId === guildId && item.id === Number(caseId));
        if (!record) return state;

        record.reason = reason;
        record.updatedAt = Date.now();
        updatedCase = record;
        return state;
    });

    return updatedCase;
}

async function clearWarningCases(guildId, userId, moderatorId, reason) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.clearWarningCases(await getSqliteDb(), guildId, userId, moderatorId, reason);
    const clearedAt = Date.now();
    let cleared = 0;

    await useLegacyStateMutation(state => {
        for (const record of state.cases) {
            if (record.guildId === guildId && record.userId === userId && record.type === 'warn' && record.active !== false) {
                record.active = false;
                record.clearedAt = clearedAt;
                record.clearedBy = moderatorId;
                record.clearReason = reason;
                record.updatedAt = clearedAt;
                cleared += 1;
            }
        }

        return state;
    });

    return cleared;
}

async function createReminder(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createReminder(await getSqliteDb(), record);
    const timestamp = Date.now();
    const reminder = {
        id: record.id || makeId(),
        guildId: record.guildId || null,
        channelId: record.channelId || null,
        userId: record.userId,
        userTag: record.userTag || null,
        message: record.message,
        remindAt: Number(record.remindAt),
        deliveredAt: null,
        status: 'pending',
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    await useLegacyStateMutation(state => {
        state.reminders ||= [];
        state.reminders.push(reminder);
        state.reminders = state.reminders.sort((a, b) => Number(a.remindAt) - Number(b.remindAt)).slice(-5000);
        return state;
    });
    return reminder;
}

async function listDueReminders(timestamp = Date.now(), limit = 25) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listDueReminders(await getSqliteDb(), timestamp, limit);
    return ((await readState()).reminders || [])
        .filter(item => item.status === 'pending' && Number(item.remindAt) <= timestamp)
        .sort((a, b) => Number(a.remindAt) - Number(b.remindAt))
        .slice(0, limit);
}

async function updateReminderStatus(id, status, error = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.updateReminderStatus(await getSqliteDb(), id, status, error);
    let updated = null;
    await useLegacyStateMutation(state => {
        const record = (state.reminders || []).find(item => item.id === id);
        if (!record) return state;
        record.status = status;
        record.error = error;
        record.deliveredAt = status === 'sent' ? Date.now() : record.deliveredAt;
        record.updatedAt = Date.now();
        updated = record;
        return state;
    });
    return updated;
}

async function markScheduledJobStart(name) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.markScheduledJobStart(await getSqliteDb(), name);
    return null;
}

async function markScheduledJobFinish(name, durationMs, error = null) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.markScheduledJobFinish(await getSqliteDb(), name, durationMs, error);
    return null;
}

async function listScheduledJobStatus() {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listScheduledJobStatus(await getSqliteDb());
    return [];
}

async function getGuildConfigurationOverrides(guildId) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') {
        const db = await getSqliteDb();
        return {
            settings: repository.listGuildSettings(db, guildId),
            logChannels: repository.listGuildLogChannels(db, guildId),
            levelRewards: repository.listGuildLevelRewards(db, guildId),
        };
    }

    const state = await readState();
    return {
        settings: (state.guildSettings || []).filter(item => item.guildId === guildId),
        logChannels: (state.guildLogChannels || []).filter(item => item.guildId === guildId),
        levelRewards: (state.guildLevelRewards || []).filter(item => item.guildId === guildId),
    };
}

function upsertStateRecord(records, keySelector, record) {
    const key = keySelector(record);
    const index = records.findIndex(item => keySelector(item) === key);
    if (index === -1) {
        records.push(record);
    } else {
        records[index] = { ...records[index], ...record };
    }
}

async function saveGuildConfigurationSection(guildId, section, payload = {}, metadata = {}) {
    const settings = getStorageSettings();
    const retention = getRetentionSettings();
    if (settings.provider === 'sqlite') {
        return repository.saveGuildConfigurationSection(await getSqliteDb(), guildId, section, payload, {
            ...metadata,
            retention,
        });
    }

    return useLegacyStateMutation(state => {
        const timestamp = metadata.updatedAt || Date.now();
        state.guildSettings ||= [];
        state.guildLogChannels ||= [];
        state.guildLevelRewards ||= [];
        state.configAudit ||= [];

        for (const [key, value] of Object.entries(payload.settings || {})) {
            upsertStateRecord(
                state.guildSettings,
                item => `${item.guildId}:${item.section}:${item.key}`,
                {
                    guildId,
                    section,
                    key,
                    value,
                    updatedBy: metadata.actorId || null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            );
        }

        for (const [key, channelId] of Object.entries(payload.logChannels || {})) {
            upsertStateRecord(
                state.guildLogChannels,
                item => `${item.guildId}:${item.key}`,
                {
                    guildId,
                    key,
                    channelId: channelId ?? '',
                    updatedBy: metadata.actorId || null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            );
        }

        if (payload.levelRewards) {
            const rewards = payload.levelRewards
                .map(reward => ({
                    xp: Number(reward.xp || 0),
                    level: reward.level === undefined ? undefined : Number(reward.level || 0),
                    roleId: reward.roleId,
                }))
                .filter(reward => reward.roleId);
            state.guildLevelRewards = state.guildLevelRewards.filter(item => item.guildId !== guildId);
            for (const reward of rewards) {
                state.guildLevelRewards.push({
                    guildId,
                    roleId: reward.roleId,
                    xp: reward.xp,
                    updatedBy: metadata.actorId || null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            }
            upsertStateRecord(
                state.guildSettings,
                item => `${item.guildId}:${item.section}:${item.key}`,
                {
                    guildId,
                    section: 'leveling',
                    key: 'roleRewards',
                    value: rewards,
                    updatedBy: metadata.actorId || null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            );
        }

        for (const entry of payload.auditEntries || []) {
            state.configAudit.push({
                id: entry.id || makeId(),
                guildId: entry.guildId,
                actorId: entry.actorId || null,
                section: entry.section,
                key: entry.key,
                previousValue: entry.previousValue,
                newValue: entry.newValue,
                source: entry.source,
                createdAt: entry.createdAt || timestamp,
            });
        }
        state.configAudit = state.configAudit
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, retention.guildConfigAuditMaxEntries);

        return state;
    });
}

async function listConfigAudit(guildId, options = {}) {
    const limit = Math.max(1, Math.min(250, Number(options.limit || 50)));
    const offset = Math.max(0, Number(options.offset || 0));
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listConfigAudit(await getSqliteDb(), guildId, { ...options, limit, offset });

    return (await readState()).configAudit
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !options.section || item.section === options.section)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(offset, offset + limit);
}

module.exports = {
    addUserHistory,
    addModNote,
    addUserXp,
    adjustUserXp,
    applyLevelProbotFinalMigration,
    appendVoiceActivity,
    clearWarningCases,
    countActiveModerationCases,
    countProcessedLevelMessage,
    createLevelCalibrationJob,
    createLevelImportJob,
    createLevelProbotScanJob,
    createLevelTestSession,
    createModerationCase,
    createEmptyState,
    createReminder,
    createScheduledMessage,
    createTicketTranscript,
    deleteScheduledMessage,
    deleteEmbedTemplate,
    deleteModNote,
    deleteTicketRecord,
    getTempMute,
    getModerationCase,
    getGuildConfigurationOverrides,
    getLevelCalibrationJob,
    getLevelImportJob,
    getLevelProbotMigrationBatch,
    getLevelProbotScanJob,
    getLevelRank,
    getLevelTestSession,
    getLimitedAccount,
    getRetentionSettings,
    getTempVoiceChannel,
    getTicketRecord,
    getTicketTranscript,
    getStarboardMessage,
    getUserLevelRecord,
    initializeStorage,
    listCommandStats,
    listDueReminders,
    listEmbedTemplates,
    listExpiredTempBans,
    listExpiredTempMutes,
    listExpiredTempRoles,
    listLimitedAccounts,
    listLevelLeaderboard,
    listDueScheduledMessages,
    listConfigAudit,
    listModNotes,
    listScheduledMessages,
    listScheduledJobStatus,
    listTicketRecords,
    listTicketTranscripts,
    listTempVoiceChannelsForGuild,
    listGuildHistory,
    listLevelCalibrationJobs,
    listLevelImportCheckpoints,
    listLevelImportJobs,
    listLevelImportMessages,
    listLevelImportMessagesPage,
    listLevelProbotAnnouncements,
    listLevelProbotMigrationBatches,
    listLevelProbotMigrationSnapshots,
    listLevelProbotScanCheckpoints,
    listLevelProbotScanJobs,
    listHighestProbotAnnouncementLevels,
    listLevelProcessedMessages,
    listLevelReconciliationRecords,
    listLevelRoleMappings,
    listLevelTestSessions,
    listLevelXpEvents,
    listUserHistory,
    listModerationCases,
    listVoiceActivity,
    readState,
    removeTempBan,
    removeLevelRoleMapping,
    removeTempMute,
    removeTempRole,
    removeTempVoiceChannel,
    rollbackLevelProbotFinalMigration,
    recordCommandUsage,
    requestCancelLevelCalibrationJob,
    requestCancelLevelImportJob,
    requestCancelLevelProbotScanJob,
    saveGuildConfigurationSection,
    setUserXp,
    setUserXpMinimum,
    summarizeProbotAnnouncementEvidence,
    updateReminderStatus,
    updateLevelImportJob,
    updateLevelProbotScanJob,
    updateLevelCalibrationJob,
    updateLevelTestSession,
    markScheduledJobFinish,
    markScheduledJobStart,
    markLevelImportMessageProcessed,
    insertLevelImportMessage,
    insertLevelProbotAnnouncement,
    insertLevelReconciliationRecord,
    insertLevelXpEvent,
    markLimitedAccountFailed,
    markLimitedAccountRestored,
    updateScheduledMessageStatus,
    updateModerationCaseReason,
    upsertEmbedTemplate,
    beginLimitedAccount,
    upsertLevelImportCheckpoint,
    upsertLevelProbotScanCheckpoint,
    upsertLevelRoleMapping,
    upsertLimitedAccount,
    upsertStarboardMessage,
    upsertTempBan,
    upsertTempMute,
    upsertTempRole,
    upsertTempVoiceChannel,
    upsertTicketRecord,
    writeState,
};
