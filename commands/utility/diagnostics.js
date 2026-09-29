const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { buildDiagnostics } = require('../../services/diagnostics');
const { createEmbed } = require('../../utils/embeds');

function formatStatus(value) {
    return value ? 'OK' : 'Issue';
}

function formatMemory(memory) {
    return `${memory.heapUsedMb}/${memory.heapTotalMb} MB heap, ${memory.rssMb} MB RSS`;
}

function formatSchedulerJobs(jobs = []) {
    if (!jobs.length) return 'No registered jobs.';
    return jobs
        .slice(0, 8)
        .map(job => {
            const lastRun = job.lastRunAt ? `<t:${Math.floor(job.lastRunAt / 1000)}:R>` : 'never';
            const error = job.lastError ? `, error: ${job.lastError.slice(0, 80)}` : '';
            return `${job.running ? 'running' : 'idle'} ${job.name} (${lastRun}${error})`;
        })
        .join('\n')
        .slice(0, 1000);
}

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('diagnostics')
        .setDescription('Show safe bot health and runtime diagnostics.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const diagnostics = await buildDiagnostics(interaction.client);
        const embed = createEmbed({
            title: 'Bot Diagnostics',
            color: diagnostics.ok ? 'green' : 'orange',
            fields: [
                { name: 'Version', value: `${diagnostics.version}${diagnostics.commitSha ? ` (${diagnostics.commitSha})` : ''}`, inline: true },
                { name: 'Runtime', value: `${diagnostics.nodeVersion}\ndiscord.js ${diagnostics.discordJsVersion}`, inline: true },
                { name: 'Uptime', value: `<t:${Math.floor((Date.now() - diagnostics.uptimeSeconds * 1000) / 1000)}:R>`, inline: true },
                { name: 'Discord', value: `${formatStatus(diagnostics.discordReady)}\nPing: ${diagnostics.gatewayPingMs ?? 'unknown'}ms\nGuilds: ${diagnostics.guildCount}`, inline: true },
                { name: 'Database', value: `${formatStatus(diagnostics.database.ok)}\n${diagnostics.database.provider}\n${diagnostics.database.latencyMs ?? 'n/a'}ms`, inline: true },
                { name: 'Scheduler', value: `${formatStatus(diagnostics.scheduler.ok)}\n${diagnostics.scheduler.jobs.length} jobs`, inline: true },
                { name: 'Memory', value: formatMemory(diagnostics.memory), inline: true },
                { name: 'Commands', value: `${diagnostics.commandCount}`, inline: true },
                { name: 'Integrations', value: Object.entries(diagnostics.integrations).map(([name, status]) => `${name}: ${status}`).join('\n').slice(0, 1000) },
                { name: 'Scheduler Jobs', value: formatSchedulerJobs(diagnostics.scheduler.jobs) },
            ],
        });

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
