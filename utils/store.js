const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');

let sqlitePromise = null;

function resolveDataPath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.jsonPath || 'data/bot-state.json');
}

function resolveSqlitePath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.sqlitePath || 'data/bot.sqlite');
}

function createEmptyState() {
    return {
        cases: [],
        history: [],
        nextCaseId: 1,
        tempBans: [],
        tempMutes: [],
        tempVoiceChannels: [],
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

function getStorageSettings() {
    const config = getConfig();
    const provider = config.database?.provider || 'sqlite';

    if (provider !== 'json') {
        if (provider !== 'sqlite') {
            console.warn(`[DATABASE] Provider "${provider}" is configured but this build only includes JSON and SQLite adapters. Falling back to SQLite storage.`);
        }
    }

    return {
        provider: provider === 'json' ? 'json' : 'sqlite',
        jsonPath: resolveDataPath(config),
        sqlitePath: resolveSqlitePath(config),
    };
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
    return readSqliteState(settings.sqlitePath);
}

async function writeState(state) {
    const settings = getStorageSettings();

    if (settings.provider === 'json') {
        writeJsonState(settings.jsonPath, state);
        return;
    }

    await writeSqliteState(settings.sqlitePath, state);
}


async function updateState(updater) {
    const state = await readState();
    const nextState = updater(state) || state;
    await writeState(nextState);
    return nextState;
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

async function addUserHistory(record) {
    const createdAt = record.createdAt || Date.now();
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

    await updateState(state => {
        state.history.push(entry);
        state.history = state.history
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5000);
        return state;
    });

    return entry;
}

async function listUserHistory(guildId, userId, limit = 15) {
    return (await readState()).history
        .filter(item => item.guildId === guildId && item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
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

async function getTempVoiceChannel(channelId) {
    return (await readState()).tempVoiceChannels.find(item => item.channelId === channelId) || null;
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
    clearWarningCases,
    createModerationCase,
    createEmptyState,
    getTempMute,
    getModerationCase,
    getTempVoiceChannel,
    listUserHistory,
    listModerationCases,
    readState,
    removeTempBan,
    removeTempMute,
    removeTempVoiceChannel,
    updateModerationCaseReason,
    upsertTempBan,
    upsertTempMute,
    upsertTempVoiceChannel,
};
