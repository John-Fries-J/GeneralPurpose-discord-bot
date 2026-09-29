const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithEnvironment(environment) {
    const previous = {};

    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    delete require.cache[require.resolve('../utils/store')];
    delete require.cache[require.resolve('../services/scheduler')];
    const store = require('../utils/store');
    const scheduler = require('../services/scheduler');
    const database = require('../database');

    return {
        store,
        scheduler,
        restore() {
            database.closeDatabase();
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
            delete require.cache[require.resolve('../utils/store')];
            delete require.cache[require.resolve('../services/scheduler')];
        },
    };
}

test('scheduler prevents the same job from running concurrently', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-scheduler-'));
    const { scheduler: schedulerModule, restore } = loadWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    let release;
    let runs = 0;
    const scheduler = new schedulerModule.Scheduler();

    try {
        scheduler.register({
            name: 'slow-job',
            run: async () => {
                runs += 1;
                await new Promise(resolve => {
                    release = resolve;
                });
            },
        });

        const first = scheduler.runJob('slow-job');
        while (runs === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        const second = await scheduler.runJob('slow-job');
        assert.deepEqual(second, { skipped: true, reason: 'already-running' });
        assert.equal(runs, 1);

        release();
        await first;
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('due reminders persist and are delivered by the scheduler job', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-reminders-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const { store, scheduler, restore } = loadWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    const sent = [];
    const client = {
        users: {
            fetch: async id => ({
                id,
                send: async payload => {
                    sent.push(payload);
                },
            }),
        },
    };

    try {
        await store.createReminder({
            guildId: 'guild',
            channelId: 'channel',
            userId: 'user',
            userTag: 'User#0001',
            message: 'Restart-safe reminder',
            remindAt: Date.now() - 1000,
        });

        const result = await scheduler.runReminderJob(client);
        const state = await store.readState();

        assert.deepEqual(result, { due: 1, sent: 1, failed: 0 });
        assert.equal(sent.length, 1);
        assert.equal(state.reminders[0].status, 'sent');
        assert.equal(state.reminders[0].message, 'Restart-safe reminder');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('createScheduler registers restart-safe recurring maintenance jobs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-scheduler-jobs-'));
    const { scheduler: schedulerModule, restore } = loadWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        const scheduler = schedulerModule.createScheduler({
            guilds: { cache: new Map() },
            users: { fetch: async () => null },
        }, {
            punishmentIntervalMs: 0,
            scheduledMessageIntervalMs: 0,
            memberCounterIntervalMs: 0,
            voiceXpIntervalMs: 0,
            ticketIntervalMs: 0,
            reminderIntervalMs: 0,
        });

        const names = (await scheduler.status()).jobs.map(job => job.name).sort();
        assert.deepEqual(names, [
            'member-counters',
            'punishments',
            'reminders',
            'scheduled-messages',
            'ticket-inactivity',
            'voice-xp',
        ]);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
