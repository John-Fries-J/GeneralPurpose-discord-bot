const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');

let sqlitePromise = null;
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

async function getSqlite() {
    if (!sqlitePromise) {
        sqlitePromise = require('sql.js')();
    }

    return sqlitePromise;
}

async function openSqliteDatabase(filePath) {
    const SQL = await getSqlite();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const database = fs.existsSync(filePath)
        ? new SQL.Database(fs.readFileSync(filePath))
        : new SQL.Database();

    database.run(`
        CREATE TABLE IF NOT EXISTS bot_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    return database;
}

function saveSqliteDatabase(database, filePath) {
    fs.writeFileSync(filePath, Buffer.from(database.export()));
}

async function readSqliteState(filePath) {
    const database = await openSqliteDatabase(filePath);
    try {
        const statement = database.prepare('SELECT key, value FROM bot_state');
        const state = createEmptyState();

        while (statement.step()) {
            const row = statement.getAsObject();
            if (row.key in state) {
                state[row.key] = JSON.parse(row.value);
            }
        }

        statement.free();
        return state;
    } finally {
        database.close();
    }
}

async function writeSqliteState(filePath, state) {
    const database = await openSqliteDatabase(filePath);
    try {
        const preparedState = { ...createEmptyState(), ...state };
        const upsert = database.prepare(`
            INSERT INTO bot_state (key, value, updated_at)
            VALUES ($key, $value, $updatedAt)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);

        database.run('BEGIN TRANSACTION');
        for (const [key, value] of Object.entries(preparedState)) {
            upsert.run({
                $key: key,
                $value: JSON.stringify(value),
                $updatedAt: Date.now(),
            });
        }
        database.run('COMMIT');
        upsert.free();
        saveSqliteDatabase(database, filePath);
    } finally {
        database.close();
    }
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

    await migrateJsonStateIfNeeded(settings);
    const database = await openSqliteDatabase(settings.sqlitePath);
    database.close();
    console.log(`[DATABASE] Active provider: sqlite (${settings.sqlitePath})`);
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

async function migrateJsonStateIfNeeded(settings) {
    if (settings.provider !== 'sqlite' || !fs.existsSync(settings.jsonPath)) return;

    const sqliteExists = fs.existsSync(settings.sqlitePath);
    if (sqliteExists) return;

    const state = readJsonState(settings.jsonPath);
    await writeSqliteState(settings.sqlitePath, state);
    console.log(`[DATABASE] Migrated JSON state from ${settings.jsonPath} to ${settings.sqlitePath}`);
}

async function readState() {
    const settings = getStorageSettings();

    if (settings.provider === 'json') {
        return readJsonState(settings.jsonPath);
    }

    await migrateJsonStateIfNeeded(settings);
    if (settings.provider === 'mysql') {
        return readMysqlState(settings);
    }

    return readSqliteState(settings.sqlitePath);
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

    await writeSqliteState(settings.sqlitePath, state);
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

async function upsertTempBan(record) {
    return updateState(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempBans.push(record);
        return state;
    });
}

async function removeTempBan(guildId, userId) {
    return updateState(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

async function upsertTempMute(record) {
    return updateState(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempMutes.push(record);
        return state;
    });
}

async function removeTempMute(guildId, userId) {
    return updateState(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

async function getTempMute(guildId, userId) {
    return (await readState()).tempMutes.find(item => item.guildId === guildId && item.userId === userId) || null;
}

async function createModerationCase(record) {
    let createdCase;

    await updateState(state => {
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

    await updateState(state => {
        state.history.push(entry);
        state.history = state.history
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, settings.maxEntries);
        return state;
    });

    return entry;
}

async function addModNote(record) {
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

    await updateState(state => {
        state.modNotes.push(note);
        state.modNotes = state.modNotes.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5000);
        return state;
    });

    return note;
}

async function listModNotes(guildId, userId, limit = 15) {
    return (await readState()).modNotes
        .filter(item => item.guildId === guildId && item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function deleteModNote(guildId, noteId) {
    let deleted = null;

    await updateState(state => {
        deleted = state.modNotes.find(item => item.guildId === guildId && item.id === noteId) || null;
        state.modNotes = state.modNotes.filter(item => !(item.guildId === guildId && item.id === noteId));
        return state;
    });

    return deleted;
}

async function listUserHistory(guildId, userId, limit = 15) {
    return (await readState()).history
        .filter(item => item.guildId === guildId && item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function recordCommandUsage(record) {
    const now = Date.now();

    return updateState(state => {
        state.commandStats.push({
            guildId: record.guildId || null,
            channelId: record.channelId || null,
            command: record.command,
            userId: record.userId,
            userTag: record.userTag,
            ok: record.ok === true,
            error: record.error || null,
            createdAt: now,
        });
        state.commandStats = state.commandStats.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10000);
        return state;
    });
}

async function listCommandStats(guildId, since = 0) {
    return (await readState()).commandStats
        .filter(item => !guildId || item.guildId === guildId)
        .filter(item => !since || item.createdAt >= since)
        .sort((a, b) => b.createdAt - a.createdAt);
}

async function upsertTempVoiceChannel(record) {
    return updateState(state => {
        state.tempVoiceChannels = state.tempVoiceChannels.filter(item => item.channelId !== record.channelId);
        state.tempVoiceChannels.push(record);
        return state;
    });
}

async function removeTempVoiceChannel(channelId) {
    return updateState(state => {
        state.tempVoiceChannels = state.tempVoiceChannels.filter(item => item.channelId !== channelId);
        return state;
    });
}

async function listTempVoiceChannelsForGuild(guildId) {
    return (await readState()).tempVoiceChannels.filter(item => item.guildId === guildId);
}

async function getTempVoiceChannel(channelId) {
    return (await readState()).tempVoiceChannels.find(item => item.channelId === channelId) || null;
}

async function upsertTempRole(record) {
    return updateState(state => {
        state.tempRoles = state.tempRoles.filter(item => !(item.guildId === record.guildId && item.userId === record.userId && item.roleId === record.roleId));
        state.tempRoles.push(record);
        return state;
    });
}

async function removeTempRole(guildId, userId, roleId) {
    return updateState(state => {
        state.tempRoles = state.tempRoles.filter(item => !(item.guildId === guildId && item.userId === userId && item.roleId === roleId));
        return state;
    });
}

async function listExpiredTempRoles(now = Date.now()) {
    return (await readState()).tempRoles.filter(record => record.expiresAt <= now);
}

async function appendVoiceActivity(record) {
    const entry = {
        guildId: record.guildId,
        userId: record.userId,
        userTag: record.userTag,
        oldChannelId: record.oldChannelId || null,
        newChannelId: record.newChannelId || null,
        type: record.type,
        createdAt: Date.now(),
    };

    await updateState(state => {
        state.voiceActivity.push(entry);
        state.voiceActivity = state.voiceActivity.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5000);
        return state;
    });

    return entry;
}

async function listVoiceActivity(guildId, limit = 50) {
    return (await readState()).voiceActivity
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function getStarboardMessage(guildId, messageId) {
    return (await readState()).starboardMessages.find(item => item.guildId === guildId && item.messageId === messageId) || null;
}

async function upsertStarboardMessage(record) {
    return updateState(state => {
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
    let updated;
    const now = Date.now();

    await updateState(state => {
        let record = state.levels.find(item => item.guildId === guildId && item.userId === userId);
        if (!record) {
            record = {
                guildId,
                userId,
                userTag,
                textXp: 0,
                voiceXp: 0,
                lastTextXpAt: 0,
                updatedAt: now,
            };
            state.levels.push(record);
        }

        if (type === 'text' && cooldownMs && now - Number(record.lastTextXpAt || 0) < cooldownMs) {
            updated = record;
            return state;
        }

        if (type === 'text') {
            record.textXp += amount;
            record.lastTextXpAt = now;
        } else {
            record.voiceXp += amount;
        }

        record.userTag = userTag;
        record.updatedAt = now;
        updated = record;
        return state;
    });

    return updated;
}

async function getUserLevelRecord(guildId, userId) {
    return (await readState()).levels.find(item => item.guildId === guildId && item.userId === userId) || null;
}

async function listLevelLeaderboard(guildId, limit = 10, mode = 'total') {
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
    const now = Date.now();
    const entry = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        guildId: record.guildId,
        channelId: record.channelId,
        content: record.content || '',
        embed: record.embed || null,
        createdBy: record.createdBy || null,
        createdAt: now,
        scheduledFor: Number(record.scheduledFor),
        sentAt: null,
        status: 'pending',
        error: null,
    };

    await updateState(state => {
        state.scheduledMessages.push(entry);
        state.scheduledMessages = state.scheduledMessages
            .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
            .slice(-1000);
        return state;
    });

    return entry;
}

async function upsertEmbedTemplate(record) {
    const now = Date.now();
    const template = {
        id: record.id || `${now}-${Math.random().toString(36).slice(2, 8)}`,
        guildId: record.guildId,
        name: record.name,
        content: record.content || '',
        embed: record.embed || null,
        updatedBy: record.updatedBy || null,
        createdAt: record.createdAt || now,
        updatedAt: now,
    };

    await updateState(state => {
        state.embedTemplates = state.embedTemplates.filter(item => !(item.guildId === template.guildId && item.id === template.id));
        state.embedTemplates.push(template);
        state.embedTemplates = state.embedTemplates.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
        return state;
    });

    return template;
}

async function listEmbedTemplates(guildId) {
    return (await readState()).embedTemplates
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function deleteEmbedTemplate(guildId, id) {
    let deleted = null;

    await updateState(state => {
        deleted = state.embedTemplates.find(item => item.guildId === guildId && item.id === id) || null;
        state.embedTemplates = state.embedTemplates.filter(item => !(item.guildId === guildId && item.id === id));
        return state;
    });

    return deleted;
}

async function listScheduledMessages(guildId, limit = 50) {
    return (await readState()).scheduledMessages
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
        .slice(0, limit);
}

async function listDueScheduledMessages(now = Date.now(), limit = 25) {
    return (await readState()).scheduledMessages
        .filter(item => item.status === 'pending' && Number(item.scheduledFor) <= now)
        .sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor))
        .slice(0, limit);
}

async function updateScheduledMessageStatus(id, status, error = null) {
    let updated = null;

    await updateState(state => {
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

async function upsertTicketRecord(record) {
    const now = Date.now();
    let updated = null;

    await updateState(state => {
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
            lastActivityAt: record.lastActivityAt || existing?.lastActivityAt || now,
            createdAt: existing?.createdAt || record.createdAt || now,
            updatedAt: now,
        };
        state.ticketRecords = state.ticketRecords.filter(item => item.channelId !== record.channelId);
        state.ticketRecords.push(updated);
        return state;
    });

    return updated;
}

async function getTicketRecord(channelId) {
    return (await readState()).ticketRecords.find(item => item.channelId === channelId) || null;
}

async function listTicketRecords(guildId, limit = 100) {
    return (await readState()).ticketRecords
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}

async function deleteTicketRecord(channelId) {
    return updateState(state => {
        state.ticketRecords = state.ticketRecords.filter(item => item.channelId !== channelId);
        return state;
    });
}

async function createTicketTranscript(record) {
    const now = Date.now();
    const transcript = {
        id: record.id || `${now}-${Math.random().toString(36).slice(2, 10)}`,
        guildId: record.guildId,
        channelId: record.channelId,
        channelName: record.channelName || record.channelId,
        ticketName: record.ticketName || record.channelName || record.channelId,
        openerId: record.openerId || null,
        createdBy: record.createdBy || null,
        createdAt: now,
        messageCount: Number(record.messageCount || 0),
        allowedUserIds: [...new Set((record.allowedUserIds || []).filter(Boolean))],
        html: record.html || '',
        text: record.text || '',
    };

    await updateState(state => {
        state.ticketTranscripts.push(transcript);
        state.ticketTranscripts = state.ticketTranscripts
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 1000);
        return state;
    });

    return transcript;
}

async function getTicketTranscript(id) {
    return (await readState()).ticketTranscripts.find(item => item.id === id) || null;
}

async function listTicketTranscripts(guildId, limit = 50) {
    return (await readState()).ticketTranscripts
        .filter(item => !guildId || item.guildId === guildId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

async function deleteScheduledMessage(id) {
    let deleted = null;

    await updateState(state => {
        deleted = state.scheduledMessages.find(item => item.id === id) || null;
        state.scheduledMessages = state.scheduledMessages.filter(item => item.id !== id);
        return state;
    });

    return deleted;
}

async function getModerationCase(guildId, caseId) {
    return (await readState()).cases.find(item => item.guildId === guildId && item.id === Number(caseId)) || null;
}

async function listModerationCases(guildId, filters = {}) {
    const state = await readState();
    return state.cases
        .filter(item => item.guildId === guildId)
        .filter(item => !filters.userId || item.userId === filters.userId)
        .filter(item => !filters.type || item.type === filters.type)
        .sort((a, b) => b.id - a.id);
}

async function updateModerationCaseReason(guildId, caseId, reason) {
    let updatedCase = null;

    await updateState(state => {
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
    const clearedAt = Date.now();
    let cleared = 0;

    await updateState(state => {
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

module.exports = {
    addUserHistory,
    addModNote,
    addUserXp,
    appendVoiceActivity,
    clearWarningCases,
    countActiveModerationCases,
    createModerationCase,
    createEmptyState,
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
    listEmbedTemplates,
    listExpiredTempRoles,
    listLevelLeaderboard,
    listDueScheduledMessages,
    listModNotes,
    listScheduledMessages,
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
    updateScheduledMessageStatus,
    updateModerationCaseReason,
    upsertEmbedTemplate,
    upsertStarboardMessage,
    upsertTempBan,
    upsertTempMute,
    upsertTempRole,
    upsertTempVoiceChannel,
    upsertTicketRecord,
};
