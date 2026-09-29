const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRestoredConfig,
    createConfigBackup,
    redactSensitiveConfig,
    restoreConfigBackup,
} = require('../web/dashboard');
const { appendDashboardLog, readDashboardLogs } = require('../utils/dashboardLogs');
const { safeErrorMessage } = require('../utils/redaction');
const { buildDiagnostics, buildHealthReport } = require('../services/diagnostics');
const { closeDatabase } = require('../database');
const { renderLayout } = require('../web/views/layout');
const {
    renderLoggingDashboard,
    renderTicketDashboard,
    renderVoiceDashboard,
} = require('../web/views/components/dashboardPanels');

function tempDirectory(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function backupFile(directory, name, value) {
    const file = `config-2026-01-01T00-00-00-000Z-${name}.json`;
    fs.writeFileSync(path.join(directory, file), value);
    return file;
}

function createClient(lastError = null) {
    return {
        isReady: () => true,
        ws: { ping: 42 },
        guilds: { cache: new Map([['guild', {}]]) },
        commands: new Map([['ping', {}]]),
        scheduler: {
            status: async () => ({
                stopped: false,
                jobs: [{
                    name: 'reminders',
                    intervalMs: 30000,
                    running: false,
                    lastRunAt: null,
                    lastDurationMs: null,
                    lastError,
                }],
            }),
        },
    };
}

test('secret redaction is recursive, case-insensitive, and URL-context aware', () => {
    const redacted = redactSensitiveConfig({
        ToKeN: 'bot-token',
        dashboard: {
            publicUrl: 'https://dashboard.example.com',
            oauth: {
                ClientSecret: 'oauth-secret',
                redirectUri: 'https://dashboard.example.com/auth/callback',
            },
        },
        services: [
            { name: 'youtube', ApiKey: 'youtube-secret', apiUrl: 'https://www.googleapis.com/youtube/v3' },
            { name: 'custom', nested: { credentials: { username: 'deploy', password: 'database-password' } } },
            {
                name: 'queue',
                nested: [
                    { connectionString: 'redis://:redis-secret@localhost:6379/0' },
                    { databaseUrl: 'postgres://user:postgres-secret@localhost/bot' },
                ],
            },
        ],
        database: {
            provider: 'mysql',
            sqlitePath: 'data/bot.sqlite',
            mysql: { url: 'mysql://user:pass@example.com/bot' },
            mongo: { URL: 'mongodb://user:pass@example.com/bot' },
        },
        moderation: {
            appealUrl: 'https://appeals.example.com',
        },
        enabled: true,
    });

    assert.equal(redacted.ToKeN, '[redacted]');
    assert.equal(redacted.dashboard.oauth.ClientSecret, '[redacted]');
    assert.equal(redacted.services[0].ApiKey, '[redacted]');
    assert.equal(redacted.services[1].nested.credentials, '[redacted]');
    assert.equal(redacted.services[2].nested[0].connectionString, '[redacted]');
    assert.equal(redacted.services[2].nested[1].databaseUrl, '[redacted]');
    assert.equal(redacted.database.mysql.url, '[redacted]');
    assert.equal(redacted.database.mongo.URL, '[redacted]');
    assert.equal(redacted.dashboard.publicUrl, 'https://dashboard.example.com');
    assert.equal(redacted.dashboard.oauth.redirectUri, 'https://dashboard.example.com/auth/callback');
    assert.equal(redacted.services[0].apiUrl, 'https://www.googleapis.com/youtube/v3');
    assert.equal(redacted.moderation.appealUrl, 'https://appeals.example.com');
    assert.equal(redacted.database.sqlitePath, 'data/bot.sqlite');
    assert.equal(redacted.enabled, true);
});

test('config backups redact deployment secrets but keep ordinary configuration useful', () => {
    const directory = tempDirectory('bot-backup-redaction-');
    try {
        const file = createConfigBackup('deployment secrets', {
            directory,
            config: {
                token: 'discord-token',
                dashboard: {
                    enabled: true,
                    publicUrl: 'https://dashboard.example.com',
                    oauth: {
                        clientId: 'client-id',
                        clientSecret: 'oauth-secret',
                        redirectUri: 'https://dashboard.example.com/auth/discord/callback',
                    },
                    sessionSecret: 'session-secret',
                },
                youtube: { apiKey: 'youtube-api-key', channels: [{ channelId: 'yt', discordChannelId: 'discord' }] },
                database: {
                    provider: 'mysql',
                    mysql: { url: 'mysql://user:password@db.example.com/bot' },
                },
                welcomeID: 'welcome-channel',
            },
        });
        const backup = fs.readFileSync(path.join(directory, file), 'utf8');

        assert.doesNotMatch(backup, /discord-token|oauth-secret|session-secret|youtube-api-key|password@db/);
        assert.match(backup, /https:\/\/dashboard\.example\.com/);
        assert.match(backup, /welcome-channel/);
        assert.equal(JSON.parse(backup).database.mysql.url, '[redacted]');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backup restore rejects malformed and dangerous input before saving', () => {
    const directory = tempDirectory('bot-restore-reject-');
    const current = { token: 'current-token', dashboard: { enabled: false }, database: { provider: 'sqlite' } };
    const saved = [];

    try {
        const malformed = backupFile(directory, 'malformed', '{"token":');
        assert.throws(
            () => restoreConfigBackup(malformed, { directory, currentConfig: current, save: value => saved.push(value) }),
            /malformed/,
        );

        const polluted = backupFile(directory, 'polluted', JSON.stringify({
            token: '[redacted]',
            nested: { constructor: { prototype: { polluted: true } } },
        }));
        assert.throws(
            () => restoreConfigBackup(polluted, { directory, currentConfig: current, save: value => saved.push(value) }),
            /Dangerous configuration key rejected/,
        );

        assert.deepEqual(saved, []);
        assert.equal({}.polluted, undefined);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backup restore preserves protected deployment values and remains atomic on validation failure', () => {
    const directory = tempDirectory('bot-restore-atomic-');
    const current = {
        token: 'current-token',
        dashboard: {
            enabled: true,
            publicUrl: 'https://old.example.com',
            oauth: { clientSecret: 'current-oauth-secret', redirectUri: 'https://old.example.com/callback' },
        },
        database: {
            provider: 'sqlite',
            sqlitePath: 'data/current.sqlite',
            mysql: { url: 'mysql://current:secret@localhost/bot' },
        },
        welcomeID: 'old-channel',
    };
    let saved = null;

    try {
        const legitimate = backupFile(directory, 'legit', JSON.stringify({
            token: 'attacker-token',
            dashboard: {
                enabled: false,
                publicUrl: 'https://new.example.com',
                oauth: { clientSecret: 'attacker-oauth-secret', redirectUri: 'https://new.example.com/callback' },
            },
            database: {
                provider: 'mysql',
                sqlitePath: 'C:/other.sqlite',
                mysql: { url: 'mysql://attacker:secret@example.com/bot' },
            },
            welcomeID: 'new-channel',
        }));
        restoreConfigBackup(legitimate, { directory, currentConfig: current, save: value => { saved = value; } });

        assert.equal(saved.token, 'current-token');
        assert.equal(saved.dashboard.oauth.clientSecret, 'current-oauth-secret');
        assert.equal(saved.database.provider, 'sqlite');
        assert.equal(saved.database.sqlitePath, 'data/current.sqlite');
        assert.equal(saved.database.mysql.url, 'mysql://current:secret@localhost/bot');
        assert.equal(saved.dashboard.publicUrl, 'https://new.example.com');
        assert.equal(saved.welcomeID, 'new-channel');

        saved = null;
        const invalid = backupFile(directory, 'invalid', JSON.stringify({ dashboard: { enabled: 'yes' } }));
        assert.throws(
            () => restoreConfigBackup(invalid, { directory, currentConfig: current, save: value => { saved = value; } }),
            /dashboard\.enabled must be a boolean/,
        );
        assert.equal(saved, null);
        assert.equal(current.welcomeID, 'old-channel');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('hostile persisted dashboard values are HTML-escaped in rendered output', () => {
    const payload = '"><script>alert(1)</script>';
    const layoutHtml = renderLayout(payload, '<section>Safe body</section>', { username: payload }, {
        user: {
            username: payload,
            displayAvatarURL: () => `https://cdn.example.com/${payload}.png`,
        },
        isReady: () => true,
        ws: { ping: 12 },
    }, 'overview', { guild: { name: payload } });
    const ticketHtml = renderTicketDashboard([
        { channelId: payload, openerTag: payload, claimedByTag: payload, status: payload, updatedAt: Date.now() },
    ], [
        { id: payload, ticketName: payload, messageCount: 1 },
    ]);
    const guild = {
        channels: {
            cache: new Map([[
                'voice-1',
                { id: 'voice-1', name: payload, isVoiceBased: () => true, members: new Map(), userLimit: 2 },
            ], [
                'log-1',
                { id: 'log-1', name: payload, isVoiceBased: () => false },
            ]]),
        },
    };
    const voiceHtml = renderVoiceDashboard([
        { channelId: 'voice-1', ownerId: payload, createdAt: Date.now() },
    ], [
        { userTag: payload, type: payload, oldChannelId: payload, newChannelId: payload, createdAt: Date.now() },
    ], guild);
    const loggingHtml = renderLoggingDashboard({ logChannels: { logChannel: 'log-1' } }, guild);
    const html = `${layoutHtml}${ticketHtml}${voiceHtml}${loggingHtml}`;

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('health and diagnostics output exclude representative secrets', async () => {
    const directory = tempDirectory('bot-health-redaction-');
    const previousToken = process.env.DISCORD_TOKEN;
    const previousProvider = process.env.DATABASE_PROVIDER;
    const previousSqlitePath = process.env.DATABASE_SQLITE_PATH;
    process.env.DISCORD_TOKEN = 'env-discord-token';
    process.env.DATABASE_PROVIDER = 'sqlite';
    process.env.DATABASE_SQLITE_PATH = path.join(directory, 'state.sqlite');

    try {
        const secretError = 'failed with password=hunter2 and mysql://user:db-password@localhost/bot';
        const health = await buildHealthReport(createClient(secretError));
        const diagnostics = await buildDiagnostics(createClient(secretError));
        const healthJson = JSON.stringify(health);
        const diagnosticsJson = JSON.stringify(diagnostics);

        assert.doesNotMatch(healthJson, /env-discord-token|hunter2|db-password/);
        assert.doesNotMatch(diagnosticsJson, /env-discord-token|hunter2|db-password/);
        assert.match(diagnosticsJson, /\[redacted\]/);
    } finally {
        closeDatabase();
        if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
        else process.env.DISCORD_TOKEN = previousToken;
        if (previousProvider === undefined) delete process.env.DATABASE_PROVIDER;
        else process.env.DATABASE_PROVIDER = previousProvider;
        if (previousSqlitePath === undefined) delete process.env.DATABASE_SQLITE_PATH;
        else process.env.DATABASE_SQLITE_PATH = previousSqlitePath;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('dashboard-visible logs and errors are redacted', () => {
    const directory = tempDirectory('bot-dashboard-logs-');
    const logPath = path.join(directory, 'dashboard.log');

    try {
        appendDashboardLog('Failure token=log-secret', {
            clientSecret: 'oauth-secret',
            error: 'database url=mysql://user:db-password@localhost/bot',
            publicUrl: 'https://dashboard.example.com',
        }, { logPath });
        const logs = readDashboardLogs(10, { logPath });
        const json = JSON.stringify(logs);

        assert.doesNotMatch(json, /log-secret|oauth-secret|db-password/);
        assert.match(json, /\[redacted\]/);
        assert.match(json, /https:\/\/dashboard\.example\.com/);
        assert.equal(safeErrorMessage(new Error('failed client_secret=oauth-secret')), 'failed client_secret=[redacted]');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('buildRestoredConfig rejects nested dangerous keys without mutating the current config', () => {
    const current = { token: 'current-token', welcomeID: 'welcome' };
    assert.throws(
        () => buildRestoredConfig(JSON.parse('{"token":"[redacted]","tickets":[{"__proto__":{"polluted":true}}]}'), current),
        /Dangerous configuration key rejected/,
    );
    assert.deepEqual(current, { token: 'current-token', welcomeID: 'welcome' });
    assert.equal({}.polluted, undefined);
});
