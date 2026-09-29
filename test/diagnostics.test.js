const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { buildDiagnostics, buildHealthReport } = require('../services/diagnostics');

function withEnvironment(environment) {
    const previous = {};
    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    return () => {
        closeDatabase();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    };
}

function createClient() {
    return {
        isReady: () => true,
        ws: { ping: 42 },
        guilds: { cache: new Map([['guild', {}]]) },
        commands: new Map([['ping', {}]]),
        scheduler: {
            status: async () => ({
                stopped: false,
                jobs: [{ name: 'reminders', intervalMs: 30000, running: false, lastRunAt: null, lastDurationMs: null, lastError: null }],
            }),
        },
    };
}

test('buildHealthReport differentiates Discord, database, and scheduler readiness', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-diagnostics-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
        DISCORD_TOKEN: 'should-not-appear',
    });

    try {
        const health = await buildHealthReport(createClient());
        assert.equal(health.ok, true);
        assert.equal(health.discordReady, true);
        assert.equal(health.databaseReadable, true);
        assert.equal(health.databaseWritable, true);
        assert.equal(health.schedulerAlive, true);
        assert.equal(JSON.stringify(health).includes('should-not-appear'), false);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('buildDiagnostics includes safe runtime metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-diagnostics-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        const diagnostics = await buildDiagnostics(createClient());
        assert.equal(diagnostics.version, '1.0.0');
        assert.equal(diagnostics.gatewayPingMs, 42);
        assert.equal(diagnostics.guildCount, 1);
        assert.equal(diagnostics.commandCount, 1);
        assert.equal(diagnostics.scheduler.jobs[0].name, 'reminders');
        assert.equal(typeof diagnostics.memory.heapUsedMb, 'number');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
