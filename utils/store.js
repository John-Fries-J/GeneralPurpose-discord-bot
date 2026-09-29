const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');
const database = require('../database');
const repository = require('../database/repositories/storeRepository');

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
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function recordCommandUsage(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.recordCommandUsage(await getSqliteDb(), record);
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
        state.commandStats = state.commandStats.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10000);
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
    if (settings.provider === 'sqlite') return repository.appendVoiceActivity(await getSqliteDb(), record);
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
        state.voiceActivity = state.voiceActivity.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5000);
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

async function listLevelLeaderboard(guildId, limit = 10, mode = 'total') {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.listLevelLeaderboard(await getSqliteDb(), guildId, limit, mode);
    const score = record => {
        if (mode === 'text') return Number(record.textXp || 0);
        if (mode === 'voice') return Number(record.voiceXp || 0);
        return Number(record.textXp || 0) + Number(record.voiceXp || 0);
    };

    return (await readState()).levels
        .filter(item => item.guildId === guildId)
        .filter(item => score(item) > 0)
        .sort((a, b) => score(b) - score(a))
        .slice(0, limit);
}

async function createScheduledMessage(record) {
    const settings = getStorageSettings();
    if (settings.provider === 'sqlite') return repository.createScheduledMessage(await getSqliteDb(), record);
    const timestamp = Date.now();
    const entry = {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
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
        id: record.id || `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
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
        id: record.id || `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
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
        id: record.id || `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
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

module.exports = {
    addUserHistory,
    addModNote,
    addUserXp,
    appendVoiceActivity,
    clearWarningCases,
    countActiveModerationCases,
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
    listLevelLeaderboard,
    listDueScheduledMessages,
    listModNotes,
    listScheduledMessages,
    listScheduledJobStatus,
    listTicketRecords,
    listTicketTranscripts,
    listTempVoiceChannelsForGuild,
    listUserHistory,
    listModerationCases,
    listVoiceActivity,
    readState,
    removeTempBan,
    removeTempMute,
    removeTempRole,
    removeTempVoiceChannel,
    recordCommandUsage,
    updateReminderStatus,
    markScheduledJobFinish,
    markScheduledJobStart,
    updateScheduledMessageStatus,
    updateModerationCaseReason,
    upsertEmbedTemplate,
    upsertStarboardMessage,
    upsertTempBan,
    upsertTempMute,
    upsertTempRole,
    upsertTempVoiceChannel,
    upsertTicketRecord,
    writeState,
};
