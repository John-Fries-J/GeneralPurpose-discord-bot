module.exports = [
    // Existing migrations 1-3 remain in database/index.js during staged extraction.
    // Add new migrations here as { version, name, sql } or { version, name, up(db) }.
    {
        version: 4,
        name: 'honeypot_limited_accounts',
        sql: `
            CREATE TABLE IF NOT EXISTS honeypot_limited_accounts (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                previous_role_ids_json TEXT NOT NULL,
                limited_role_id TEXT NOT NULL,
                limited_channel_id TEXT,
                limited_by TEXT,
                limited_at INTEGER NOT NULL,
                restored_by TEXT,
                restored_at INTEGER,
                restoration_source TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_honeypot_limited_status ON honeypot_limited_accounts(guild_id, status);
            CREATE INDEX IF NOT EXISTS idx_honeypot_limited_updated ON honeypot_limited_accounts(updated_at);
        `,
    },
];
