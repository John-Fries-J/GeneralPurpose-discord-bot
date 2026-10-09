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
    {
        version: 5,
        name: 'leveling_migration_and_testing',
        sql: `
            CREATE TABLE IF NOT EXISTS level_xp_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_tag TEXT,
                source TEXT NOT NULL,
                source_key TEXT,
                xp_type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                previous_text_xp INTEGER NOT NULL DEFAULT 0,
                previous_voice_xp INTEGER NOT NULL DEFAULT 0,
                new_text_xp INTEGER NOT NULL DEFAULT 0,
                new_voice_xp INTEGER NOT NULL DEFAULT 0,
                admin_id TEXT,
                job_id TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_level_xp_events_source_key ON level_xp_events(guild_id, source, source_key) WHERE source_key IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_level_xp_events_guild_user ON level_xp_events(guild_id, user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_level_xp_events_job ON level_xp_events(job_id);

            CREATE TABLE IF NOT EXISTS level_import_jobs (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                target_user_id TEXT,
                status TEXT NOT NULL,
                dry_run INTEGER NOT NULL DEFAULT 1,
                profile_hash TEXT NOT NULL,
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_by TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                current_channel_id TEXT,
                channels_total INTEGER NOT NULL DEFAULT 0,
                channels_scanned INTEGER NOT NULL DEFAULT 0,
                messages_seen INTEGER NOT NULL DEFAULT 0,
                messages_eligible INTEGER NOT NULL DEFAULT 0,
                members_seen INTEGER NOT NULL DEFAULT 0,
                xp_estimated INTEGER NOT NULL DEFAULT 0,
                xp_applied INTEGER NOT NULL DEFAULT 0,
                skipped_channels_json TEXT NOT NULL DEFAULT '[]',
                errors_json TEXT NOT NULL DEFAULT '[]',
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                provenance_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_level_import_jobs_guild_status ON level_import_jobs(guild_id, status, updated_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_level_import_jobs_active ON level_import_jobs(guild_id) WHERE status IN ('queued', 'running', 'cancelling');

            CREATE TABLE IF NOT EXISTS level_import_checkpoints (
                job_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                parent_channel_id TEXT,
                before_message_id TEXT,
                oldest_message_id TEXT,
                status TEXT NOT NULL,
                messages_seen INTEGER NOT NULL DEFAULT 0,
                messages_eligible INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (job_id, channel_id),
                FOREIGN KEY (job_id) REFERENCES level_import_jobs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_level_import_checkpoints_job_status ON level_import_checkpoints(job_id, status);

            CREATE TABLE IF NOT EXISTS level_import_messages (
                job_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_tag TEXT,
                channel_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                xp_amount INTEGER NOT NULL DEFAULT 0,
                eligible INTEGER NOT NULL DEFAULT 1,
                skip_reason TEXT,
                PRIMARY KEY (job_id, message_id),
                FOREIGN KEY (job_id) REFERENCES level_import_jobs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_level_import_messages_job_created ON level_import_messages(job_id, created_at, message_id);
            CREATE INDEX IF NOT EXISTS idx_level_import_messages_user ON level_import_messages(job_id, user_id, created_at);

            CREATE TABLE IF NOT EXISTS level_import_processed_messages (
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                profile_hash TEXT NOT NULL,
                job_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                xp_amount INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (guild_id, message_id, profile_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_level_processed_job ON level_import_processed_messages(job_id);

            CREATE TABLE IF NOT EXISTS level_role_level_mappings (
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                minimum_level INTEGER NOT NULL,
                created_by TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (guild_id, role_id)
            );
            CREATE INDEX IF NOT EXISTS idx_level_role_mappings_guild_level ON level_role_level_mappings(guild_id, minimum_level);

            CREATE TABLE IF NOT EXISTS level_reconciliation_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_tag TEXT,
                existing_xp INTEGER NOT NULL DEFAULT 0,
                message_estimated_xp INTEGER NOT NULL DEFAULT 0,
                message_estimated_level INTEGER NOT NULL DEFAULT 0,
                role_min_level INTEGER NOT NULL DEFAULT 0,
                role_min_xp INTEGER NOT NULL DEFAULT 0,
                final_xp INTEGER NOT NULL DEFAULT 0,
                policy TEXT NOT NULL,
                dry_run INTEGER NOT NULL DEFAULT 1,
                applied INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_level_reconciliation_job ON level_reconciliation_records(job_id);
            CREATE INDEX IF NOT EXISTS idx_level_reconciliation_guild_user ON level_reconciliation_records(guild_id, user_id);

            CREATE TABLE IF NOT EXISTS level_test_sessions (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_tag TEXT,
                admin_id TEXT NOT NULL,
                status TEXT NOT NULL,
                preview_only INTEGER NOT NULL DEFAULT 1,
                previous_text_xp INTEGER NOT NULL DEFAULT 0,
                previous_voice_xp INTEGER NOT NULL DEFAULT 0,
                xp_delta INTEGER NOT NULL DEFAULT 0,
                xp_type TEXT NOT NULL DEFAULT 'text',
                managed_role_ids_json TEXT NOT NULL DEFAULT '[]',
                added_role_ids_json TEXT NOT NULL DEFAULT '[]',
                removed_role_ids_json TEXT NOT NULL DEFAULT '[]',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                rolled_back_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_level_test_sessions_guild_user ON level_test_sessions(guild_id, user_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_levels_guild_text_xp ON levels(guild_id, text_xp DESC);
            CREATE INDEX IF NOT EXISTS idx_levels_guild_voice_xp ON levels(guild_id, voice_xp DESC);
            CREATE INDEX IF NOT EXISTS idx_levels_guild_total_xp ON levels(guild_id, (text_xp + voice_xp) DESC);
        `,
    },
    {
        version: 6,
        name: 'level_calibration_jobs',
        sql: `
            CREATE TABLE IF NOT EXISTS level_calibration_jobs (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                import_job_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                profile_json TEXT NOT NULL DEFAULT '{}',
                options_json TEXT NOT NULL DEFAULT '{}',
                progress_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_level_calibration_jobs_guild_status ON level_calibration_jobs(guild_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_level_calibration_jobs_import ON level_calibration_jobs(import_job_id, updated_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_level_calibration_jobs_active_import ON level_calibration_jobs(guild_id, import_job_id) WHERE status IN ('queued', 'running', 'cancelling');
        `,
    },
];
