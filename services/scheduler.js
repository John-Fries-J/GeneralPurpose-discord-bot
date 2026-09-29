const { createEmbed } = require('../utils/embeds');
const {
    listDueReminders,
    listScheduledJobStatus,
    markScheduledJobFinish,
    markScheduledJobStart,
    updateReminderStatus,
} = require('../utils/store');
const { autoCloseInactiveTickets } = require('../utils/tickets');
const { awardVoiceXp } = require('../utils/leveling');
const { expireTempBans, expireTempMutes, expireTempRoles } = require('../utils/punishments');
const { refreshMemberCounters } = require('../utils/memberCounters');
const { runScheduledMessages } = require('../utils/scheduledMessages');
const { logger } = require('../utils/logger');
const { safeErrorMessage } = require('../utils/redaction');

const defaultReminderIntervalMs = 30 * 1000;

class Scheduler {
    constructor({ logger: schedulerLogger = logger.child({ component: 'scheduler' }) } = {}) {
        this.jobs = new Map();
        this.running = new Set();
        this.timers = new Map();
        this.logger = schedulerLogger;
        this.stopped = false;
    }

    register(job) {
        if (!job?.name || typeof job.run !== 'function') {
            throw new Error('Scheduler jobs require a name and run function.');
        }
        if (this.jobs.has(job.name)) {
            throw new Error(`Scheduler job "${job.name}" is already registered.`);
        }

        this.jobs.set(job.name, {
            intervalMs: Number(job.intervalMs || 0),
            runOnStart: job.runOnStart !== false,
            ...job,
        });
    }

    start() {
        this.stopped = false;
        for (const job of this.jobs.values()) {
            if (job.runOnStart) {
                this.runJob(job.name).catch(error => {
                    this.logger.error?.('Scheduler startup run failed', { job: job.name, error });
                });
            }

            if (job.intervalMs > 0) {
                const timer = setInterval(() => {
                    this.runJob(job.name).catch(error => {
                        this.logger.error?.('Scheduler interval run failed', { job: job.name, error });
                    });
                }, job.intervalMs);
                this.timers.set(job.name, timer);
            }
        }
    }

    async runJob(name) {
        if (this.stopped) return { skipped: true, reason: 'stopped' };
        const job = this.jobs.get(name);
        if (!job) return { skipped: true, reason: 'unknown' };
        if (this.running.has(name)) return { skipped: true, reason: 'already-running' };

        this.running.add(name);
        const started = Date.now();
        await markScheduledJobStart(name).catch(() => null);

        try {
            const result = await job.run();
            await markScheduledJobFinish(name, Date.now() - started, null).catch(() => null);
            return { ok: true, result };
        } catch (error) {
            await markScheduledJobFinish(name, Date.now() - started, safeErrorMessage(error, 'Scheduler job failed.')).catch(() => null);
            this.logger.error?.('Scheduler job failed', { job: name, error });
            return { ok: false, error };
        } finally {
            this.running.delete(name);
        }
    }

    async status() {
        const persisted = await listScheduledJobStatus().catch(() => []);
        return {
            stopped: this.stopped,
            jobs: [...this.jobs.values()].map(job => {
                const record = persisted.find(item => item.name === job.name) || {};
                return {
                    name: job.name,
                    intervalMs: job.intervalMs,
                    running: this.running.has(job.name),
                    lastRunAt: record.lastRunAt || null,
                    lastDurationMs: record.lastDurationMs || null,
                    lastError: record.lastError || null,
                    runningSince: record.runningSince || null,
                };
            }),
        };
    }

    stop() {
        this.stopped = true;
        for (const timer of this.timers.values()) clearInterval(timer);
        this.timers.clear();
    }
}

async function deliverReminder(client, reminder) {
    const user = await client.users.fetch(reminder.userId).catch(() => null);
    if (!user?.send) {
        throw new Error('Reminder user could not be fetched.');
    }

    const embed = createEmbed({
        title: 'Reminder',
        description: reminder.message,
        color: 'blue',
        fields: [
            { name: 'Scheduled for', value: `<t:${Math.floor(Number(reminder.remindAt) / 1000)}:F>` },
        ],
    });

    await user.send({ embeds: [embed] });
}

async function runReminderJob(client, { limit = 25 } = {}) {
    const due = await listDueReminders(Date.now(), limit);
    let sent = 0;
    let failed = 0;

    for (const reminder of due) {
        try {
            await updateReminderStatus(reminder.id, 'sending');
            await deliverReminder(client, reminder);
            await updateReminderStatus(reminder.id, 'sent');
            sent += 1;
        } catch (error) {
            await updateReminderStatus(reminder.id, 'failed', safeErrorMessage(error, 'Reminder delivery failed.')).catch(() => null);
            failed += 1;
        }
    }

    return { due: due.length, sent, failed };
}

function createScheduler(client, options = {}) {
    const scheduler = new Scheduler({ logger: options.logger?.child?.({ component: 'scheduler' }) || options.logger });
    scheduler.register({
        name: 'punishments',
        intervalMs: options.punishmentIntervalMs ?? 60 * 1000,
        runOnStart: true,
        run: async () => {
            const [bans, mutes, roles] = await Promise.all([
                expireTempBans(client),
                expireTempMutes(client),
                expireTempRoles(client),
            ]);
            return { bans, mutes, roles };
        },
    });
    scheduler.register({
        name: 'scheduled-messages',
        intervalMs: options.scheduledMessageIntervalMs ?? 30 * 1000,
        runOnStart: true,
        run: () => runScheduledMessages(client),
    });
    scheduler.register({
        name: 'member-counters',
        intervalMs: options.memberCounterIntervalMs ?? 5 * 60 * 1000,
        runOnStart: true,
        run: () => refreshMemberCounters(client),
    });
    scheduler.register({
        name: 'voice-xp',
        intervalMs: options.voiceXpIntervalMs ?? 60 * 1000,
        runOnStart: true,
        run: () => awardVoiceXp(client),
    });
    scheduler.register({
        name: 'ticket-inactivity',
        intervalMs: options.ticketIntervalMs ?? 60 * 60 * 1000,
        runOnStart: true,
        run: () => autoCloseInactiveTickets(client),
    });
    scheduler.register({
        name: 'reminders',
        intervalMs: options.reminderIntervalMs ?? defaultReminderIntervalMs,
        runOnStart: true,
        run: () => runReminderJob(client, options.reminders),
    });
    return scheduler;
}

module.exports = {
    Scheduler,
    createScheduler,
    deliverReminder,
    runReminderJob,
};
