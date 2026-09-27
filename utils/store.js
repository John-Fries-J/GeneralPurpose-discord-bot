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
        tempBans: [],
        tempMutes: [],
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

module.exports = {
    createEmptyState,
    getTempMute,
    readState,
    removeTempBan,
    removeTempMute,
    upsertTempBan,
    upsertTempMute,
};
