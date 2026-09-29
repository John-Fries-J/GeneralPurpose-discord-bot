const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { version: discordJsVersion } = require('discord.js');
const { version: voiceVersion } = require('@discordjs/voice');
const packageJson = require('../package.json');
const { getConfig } = require('../utils/config');
const { redactText, safeErrorMessage } = require('../utils/redaction');
const database = require('../database');

let cachedCommitSha;

function getCommitSha() {
    if (process.env.GIT_SHA) return process.env.GIT_SHA;
    if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
    if (cachedCommitSha !== undefined) return cachedCommitSha;

    try {
        cachedCommitSha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        cachedCommitSha = null;
    }

    return cachedCommitSha;
}

function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        rssMb: Math.round(usage.rss / 1024 / 1024),
        heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),
    };
}

async function getDatabaseStatus() {
    const config = getConfig();
    const provider = config.database?.provider || 'sqlite';

    try {
        const health = provider === 'sqlite'
            ? await database.healthcheck()
            : { provider, latencyMs: null };
        return {
            ok: true,
            readable: true,
            writable: provider === 'sqlite' ? health.writable === true : null,
            provider: health.provider || provider,
            latencyMs: health.latencyMs,
        };
    } catch {
        return {
            ok: false,
            readable: false,
            writable: false,
            provider,
            error: 'Database healthcheck failed.',
        };
    }
}

async function getSchedulerStatus(client) {
    if (!client.scheduler?.status) {
        return { ok: false, jobs: [], error: 'Scheduler is not initialized.' };
    }

    try {
        const status = await client.scheduler.status();
        return {
            ok: status.stopped !== true,
            stopped: status.stopped,
            jobs: (status.jobs || []).map(job => ({
                name: job.name,
                intervalMs: job.intervalMs,
                running: job.running === true,
                lastRunAt: job.lastRunAt || null,
                lastDurationMs: job.lastDurationMs || null,
                lastError: job.lastError ? redactText(String(job.lastError)).slice(0, 200) : null,
                runningSince: job.runningSince || null,
            })),
        };
    } catch (error) {
        return { ok: false, jobs: [], error: safeErrorMessage(error, 'Scheduler status unavailable.') };
    }
}

function getExternalIntegrationStatus(config = getConfig()) {
    return {
        dashboard: config.dashboard?.enabled === true ? 'enabled' : 'disabled',
        namelessMc: config.namelessmc?.enabled === true ? 'enabled' : 'disabled',
        youtube: config.mediaAnnouncements?.youtube?.enabled === true ? 'enabled' : 'disabled',
        twitch: config.mediaAnnouncements?.twitch?.enabled === true ? 'enabled' : 'disabled',
        music: config.music?.enabled === false ? 'disabled' : 'enabled',
    };
}

async function buildDiagnostics(client) {
    const [databaseStatus, schedulerStatus] = await Promise.all([
        getDatabaseStatus(),
        getSchedulerStatus(client),
    ]);

    const ready = client.isReady?.() === true;
    return {
        ok: ready && databaseStatus.ok && schedulerStatus.ok,
        processAlive: true,
        discordReady: ready,
        version: packageJson.version,
        commitSha: getCommitSha(),
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.release()}`,
        discordJsVersion,
        voiceVersion,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: getMemoryUsage(),
        gatewayPingMs: Number.isFinite(client.ws?.ping) ? client.ws.ping : null,
        guildCount: client.guilds?.cache?.size || 0,
        commandCount: client.commands?.size || 0,
        database: databaseStatus,
        scheduler: schedulerStatus,
        integrations: getExternalIntegrationStatus(),
    };
}

async function buildHealthReport(client) {
    const diagnostics = await buildDiagnostics(client);
    return {
        ok: diagnostics.ok,
        processAlive: diagnostics.processAlive,
        discordReady: diagnostics.discordReady,
        databaseReadable: diagnostics.database.readable,
        databaseWritable: diagnostics.database.writable,
        schedulerAlive: diagnostics.scheduler.ok,
        uptimeSeconds: diagnostics.uptimeSeconds,
        guilds: diagnostics.guildCount,
        gatewayPingMs: diagnostics.gatewayPingMs,
        database: {
            provider: diagnostics.database.provider,
            latencyMs: diagnostics.database.latencyMs,
            error: diagnostics.database.error,
        },
    };
}

async function buildPublicHealthReport(client) {
    const health = await buildHealthReport(client);
    return {
        ok: health.ok,
        processAlive: health.processAlive,
        discordReady: health.discordReady,
        databaseReadable: health.databaseReadable,
        databaseWritable: health.databaseWritable,
        schedulerAlive: health.schedulerAlive,
        uptimeSeconds: health.uptimeSeconds,
    };
}

module.exports = {
    buildDiagnostics,
    buildHealthReport,
    buildPublicHealthReport,
    getCommitSha,
    getDatabaseStatus,
    getSchedulerStatus,
};
