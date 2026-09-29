const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getConfig } = require('../utils/config');

const schemaVersion = 1;

let cached = null;

function resolveSqlitePath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.sqlitePath || 'data/bot.sqlite');
}

function resolveJsonPath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.jsonPath || 'data/bot-state.json');
}

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function openDatabase(filePath = resolveSqlitePath()) {
    const resolved = path.resolve(filePath);
    if (cached?.path === resolved) return cached.db;

    if (cached?.db) cached.db.close();
    ensureDirectory(resolved);
    const db = new Database(resolved);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    cached = { path: resolved, db };
    return db;
}

function closeDatabase() {
    const db = cached?.db;
    cached = null;
    if (!db || db.open === false) return false;
    db.close();
    return true;
}

function tableExists(db, name) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function migrationApplied(db, version) {
    return Boolean(db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version));
}

function applyMigration(db, version, name, sql) {
    if (migrationApplied(db, version)) return false;
    db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, name, Date.now());
    })();
    return true;
}

function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        );
    `);

    applyMigration(db, 1, 'normalized_core_schema', `
        CREATE TABLE moderation_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            type TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            moderator_id TEXT,
            moderator_tag TEXT,
            reason TEXT,
            duration TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            cleared_at INTEGER,
            cleared_by TEXT,
            clear_reason TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_moderation_cases_guild ON moderation_cases(guild_id);
        CREATE INDEX idx_moderation_cases_user ON moderation_cases(user_id);
        CREATE INDEX idx_moderation_cases_guild_user ON moderation_cases(guild_id, user_id);

        CREATE TABLE moderation_notes (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            moderator_id TEXT,
            moderator_tag TEXT,
            note TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_moderation_notes_guild_user ON moderation_notes(guild_id, user_id);

        CREATE TABLE temporary_bans (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            moderator_id TEXT,
            reason TEXT,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX idx_temporary_bans_due ON temporary_bans(expires_at);

        CREATE TABLE temporary_mutes (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            moderator_id TEXT,
            reason TEXT,
            removed_role_ids TEXT NOT NULL DEFAULT '[]',
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX idx_temporary_mutes_due ON temporary_mutes(expires_at);

        CREATE TABLE temporary_roles (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            moderator_id TEXT,
            reason TEXT,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id, role_id)
        );
        CREATE INDEX idx_temporary_roles_due ON temporary_roles(expires_at);

        CREATE TABLE reminders (
            id TEXT PRIMARY KEY,
            guild_id TEXT,
            channel_id TEXT,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            message TEXT NOT NULL,
            remind_at INTEGER NOT NULL,
            delivered_at INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_reminders_due ON reminders(status, remind_at);
        CREATE INDEX idx_reminders_user ON reminders(user_id);

        CREATE TABLE scheduled_messages (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            content TEXT,
            embed_json TEXT,
            created_by TEXT,
            scheduled_for INTEGER NOT NULL,
            sent_at INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_scheduled_messages_due ON scheduled_messages(status, scheduled_for);
        CREATE INDEX idx_scheduled_messages_guild ON scheduled_messages(guild_id);

        CREATE TABLE scheduled_jobs (
            name TEXT PRIMARY KEY,
            last_run_at INTEGER,
            last_duration_ms INTEGER,
            last_error TEXT,
            running_since INTEGER,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE levels (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            text_xp INTEGER NOT NULL DEFAULT 0,
            voice_xp INTEGER NOT NULL DEFAULT 0,
            last_text_xp_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX idx_levels_guild ON levels(guild_id);
        CREATE INDEX idx_levels_user ON levels(user_id);

        CREATE TABLE reaction_roles (
            guild_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            emoji TEXT NOT NULL,
            role_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, message_id, emoji)
        );

        CREATE TABLE tickets (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL UNIQUE,
            opener_id TEXT,
            opener_tag TEXT,
            claimed_by_id TEXT,
            claimed_by_tag TEXT,
            priority TEXT NOT NULL DEFAULT 'normal',
            tags_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'open',
            close_reason TEXT,
            closed_at INTEGER,
            last_activity_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_tickets_guild ON tickets(guild_id);
        CREATE INDEX idx_tickets_status ON tickets(guild_id, status);

        CREATE TABLE ticket_members (
            ticket_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'participant',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (ticket_id, user_id),
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );

        CREATE TABLE ticket_transcripts (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            channel_name TEXT,
            ticket_name TEXT,
            opener_id TEXT,
            created_by TEXT,
            message_count INTEGER NOT NULL DEFAULT 0,
            allowed_user_ids_json TEXT NOT NULL DEFAULT '[]',
            html TEXT,
            text TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_ticket_transcripts_guild ON ticket_transcripts(guild_id);

        CREATE TABLE temporary_voice_channels (
            channel_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            trigger_channel_id TEXT,
            name TEXT,
            locked INTEGER NOT NULL DEFAULT 0,
            user_limit INTEGER NOT NULL DEFAULT 0,
            last_occupied_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_temp_voice_guild ON temporary_voice_channels(guild_id);
        CREATE INDEX idx_temp_voice_owner ON temporary_voice_channels(owner_id);

        CREATE TABLE voice_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            old_channel_id TEXT,
            new_channel_id TEXT,
            type TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_voice_activity_guild_created ON voice_activity(guild_id, created_at);
        CREATE INDEX idx_voice_activity_user ON voice_activity(user_id);

        CREATE TABLE command_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            channel_id TEXT,
            command TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            ok INTEGER NOT NULL,
            error TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_command_usage_guild_created ON command_usage(guild_id, created_at);
        CREATE INDEX idx_command_usage_user ON command_usage(user_id);

        CREATE TABLE user_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_tag TEXT,
            type TEXT NOT NULL,
            summary TEXT NOT NULL,
            channel_id TEXT,
            moderator_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_user_history_guild_user ON user_history(guild_id, user_id);
        CREATE INDEX idx_user_history_created ON user_history(created_at);

        CREATE TABLE embed_templates (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT,
            embed_json TEXT,
            updated_by TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (guild_id, name)
        );
        CREATE INDEX idx_embed_templates_guild ON embed_templates(guild_id);

        CREATE TABLE starboard_messages (
            guild_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            starboard_channel_id TEXT NOT NULL,
            starboard_message_id TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, message_id)
        );
    `);
}

function backupFile(filePath, label = 'legacy') {
    if (!fs.existsSync(filePath)) return null;
    const backupPath = `${filePath}.${label}.${Date.now()}.bak`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function readLegacyBotState(db) {
    if (!tableExists(db, 'bot_state')) return null;
    const rows = db.prepare('SELECT key, value FROM bot_state').all();
    if (!rows.length) return null;
    const state = {};
    for (const row of rows) state[row.key] = JSON.parse(row.value);
    return state;
}

function readLegacyJsonState(jsonPath) {
    if (!fs.existsSync(jsonPath)) return null;
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function legacyImportApplied(db) {
    return Boolean(db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(9_000_001));
}

function markLegacyImportApplied(db, name) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(9_000_001, name, Date.now());
}

function migrateLegacyStateIfNeeded(db, options = {}) {
    if (legacyImportApplied(db)) return null;

    const sqlitePath = options.sqlitePath || resolveSqlitePath();
    const jsonPath = options.jsonPath || resolveJsonPath();
    const legacySqliteState = readLegacyBotState(db);
    const legacyJsonState = legacySqliteState ? null : readLegacyJsonState(jsonPath);
    const source = legacySqliteState ? 'bot_state' : (legacyJsonState ? 'json' : null);
    const state = legacySqliteState || legacyJsonState;

    if (!state) {
        markLegacyImportApplied(db, 'legacy_state_import_none');
        return { source: null, counts: {} };
    }

    const backups = [];
    const backup = source === 'bot_state'
        ? backupFile(sqlitePath, 'pre-normalized')
        : backupFile(jsonPath, 'pre-normalized');
    if (backup) backups.push(backup);

    const counts = db.transaction(() => {
        const { importState } = require('./repositories/storeRepository');
        const result = importState(db, state);
        markLegacyImportApplied(db, `legacy_state_import_${source}`);
        return result;
    })();

    return { source, counts, backups };
}

async function initializeDatabase(options = {}) {
    const db = await openDatabase(options.sqlitePath || resolveSqlitePath());
    runMigrations(db);
    const legacy = migrateLegacyStateIfNeeded(db, {
        sqlitePath: options.sqlitePath || resolveSqlitePath(),
        jsonPath: options.jsonPath || resolveJsonPath(),
    });
    return { db, legacy, schemaVersion };
}

async function healthcheck() {
    const db = await openDatabase();
    const started = Date.now();
    runMigrations(db);
    db.prepare('SELECT 1 AS ok').get();
    db.transaction(() => {
        db.prepare('INSERT OR REPLACE INTO scheduled_jobs (name, last_run_at, last_duration_ms, last_error, running_since, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)').run('__healthcheck', Date.now(), 0, Date.now());
        db.prepare('DELETE FROM scheduled_jobs WHERE name = ?').run('__healthcheck');
    })();
    return { provider: 'sqlite', latencyMs: Date.now() - started, path: cached.path, writable: true };
}

module.exports = {
    closeDatabase,
    healthcheck,
    initializeDatabase,
    openDatabase,
    resolveJsonPath,
    resolveSqlitePath,
    runMigrations,
};
