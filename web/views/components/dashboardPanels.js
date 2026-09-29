const { escapeHtml } = require('./html');

const schedulerKeys = [
    'punishmentScheduler',
    'memberCounterScheduler',
    'mediaAnnouncementScheduler',
    'levelingScheduler',
    'scheduledMessageScheduler',
];

const moduleDescriptions = {
    moderation: 'Warnings, punishments, history, notes, and safety automation.',
    ticket: 'Ticket panels, claims, transcripts, and support workflows.',
    tickets: 'Ticket panels, claims, transcripts, and support workflows.',
    utility: 'General server tools, diagnostics, announcements, and information commands.',
    config: 'Administrator setup commands and server configuration helpers.',
    suggestions: 'Suggestion submission, review, and community feedback.',
    music: 'Playback, queues, voice diagnostics, and player controls.',
    context: 'Right-click user and message actions for staff workflows.',
};

const moduleRoutes = {
    moderation: '/moderation',
    ticket: '/tickets',
    tickets: '/tickets',
    utility: '/commands',
    config: '/config',
    suggestions: '/community',
    music: '/music',
    context: '/moderation',
};

const loggingRows = [
    ['moderation', 'Moderation', ['moderation']],
    ['ticket', 'Tickets', ['ticket']],
    ['message', 'Messages', ['messageDelete', 'editMessage']],
    ['thread', 'Threads', ['threadCreate', 'threadUpdate', 'threadDelete']],
    ['suggestion', 'Suggestions', ['suggestion']],
    ['directMessage', 'Direct messages', ['directMessage']],
    ['default', 'Default fallback', ['logChannel']],
];

function formatDuration(seconds = 0) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m`;
    return `${total}s`;
}

function formatDateTime(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString();
}

function statusPill(label, state = 'neutral') {
    return `<span class="status-pill ${escapeHtml(state)}">${escapeHtml(label)}</span>`;
}

function renderMetric(label, value, detail = '') {
    return `<div class="panel metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function isTicketOpen(record) {
    return !['closed', 'deleted', 'archived'].includes(String(record.status || 'open').toLowerCase());
}

function summarizeTickets(records = [], now = Date.now()) {
    const open = records.filter(isTicketOpen);
    const closedSince = now - (7 * 24 * 60 * 60 * 1000);

    return {
        total: records.length,
        open: open.length,
        claimed: open.filter(item => item.claimedById).length,
        unclaimed: open.filter(item => !item.claimedById).length,
        recentlyClosed: records.filter(item => !isTicketOpen(item) && Number(item.updatedAt || 0) >= closedSince).length,
    };
}

function summarizeSchedulers(client = {}) {
    const running = schedulerKeys.filter(key => Boolean(client[key])).length;
    return {
        running,
        total: schedulerKeys.length,
        healthy: running === schedulerKeys.length,
    };
}

function getGuildMemberCount(guild) {
    return guild?.memberCount ?? guild?.members?.cache?.size ?? 0;
}

function getChannel(guild, channelId) {
    return guild?.channels?.cache?.get?.(channelId) || null;
}

function channelDisplay(guild, channelId, fallback = 'Not set') {
    if (!channelId) return fallback;
    const channel = getChannel(guild, channelId);
    if (!channel) return channelId;
    const prefix = channel.isVoiceBased?.() ? '[voice]' : '#';
    return `${prefix} ${channel.name}`;
}

function getHumanMemberCount(channel) {
    return [...(channel?.members?.values?.() || [])].filter(member => !member.user?.bot).length;
}

function commandCountForModule(commandStats = [], commandNames = []) {
    const names = new Set(commandNames);
    return commandStats.filter(item => names.has(item.command)).length;
}

function renderModuleDashboard(grouped = [], settings = {}, commandStats = []) {
    const rows = grouped.map(([category, commands]) => {
        const key = String(category || '').toLowerCase();
        const enabled = settings.modules?.[category] !== false;
        const route = moduleRoutes[key] || '/commands';
        const commandNames = commands.map(command => command.data?.name).filter(Boolean);
        const usage = commandCountForModule(commandStats, commandNames);
        const description = moduleDescriptions[key] || `${commands.length} command${commands.length === 1 ? '' : 's'} in this module.`;

        return `<div class="module-row" id="module-row-${escapeHtml(key)}">
<div>
<strong>${escapeHtml(category)}</strong>
<p class="muted">${escapeHtml(description)}</p>
</div>
<span>${escapeHtml(commands.length)} commands</span>
<span>${escapeHtml(usage)} uses / 30d</span>
${statusPill(enabled ? 'Enabled' : 'Disabled', enabled ? 'good' : 'muted')}
<a class="button secondary" href="${escapeHtml(route)}">Configure</a>
</div>`;
    }).join('');

    return `<section class="panel">
<div class="settings-head"><div><h2>Module Control</h2><p class="muted">Enable modules, review recent usage, and jump into focused configuration pages.</p></div></div>
<div class="module-list">${rows || '<p class="muted">No modules loaded.</p>'}</div>
</section>`;
}

function renderRecentActivity({
    ticketRecords = [],
    moderationCases = [],
    tempVoiceChannels = [],
    voiceActivity = [],
    logs = [],
} = {}) {
    const items = [
        ...ticketRecords.map(item => ({
            at: Number(item.updatedAt || item.createdAt || 0),
            type: 'Ticket',
            text: `${item.status || 'open'} ticket ${item.channelId || ''}`,
        })),
        ...moderationCases.map(item => ({
            at: Number(item.createdAt || 0),
            type: 'Moderation',
            text: `${item.type || 'case'} ${item.userTag || item.userId || ''}`,
        })),
        ...tempVoiceChannels.map(item => ({
            at: Number(item.createdAt || item.lastOccupiedAt || 0),
            type: 'Voice',
            text: `Temporary channel ${item.name || item.channelId || ''}`,
        })),
        ...voiceActivity.slice(0, 20).map(item => ({
            at: Number(item.createdAt || 0),
            type: 'Voice',
            text: `${item.userTag || item.userId || 'Member'} ${item.type || 'changed voice state'}`,
        })),
        ...logs.slice(0, 20).map(item => ({
            at: Date.parse(item.at) || 0,
            type: item.type || 'Dashboard',
            text: item.message || '',
        })),
    ].filter(item => item.at || item.text)
        .sort((a, b) => b.at - a.at)
        .slice(0, 12);

    const rows = items.map(item => `<div class="activity-row">
<span>${statusPill(item.type, 'neutral')}</span>
<span>${escapeHtml(item.text)}</span>
<span class="muted">${escapeHtml(formatDateTime(item.at))}</span>
</div>`).join('');

    return `<section class="panel wide">
<h2>Recent Activity</h2>
<div class="activity-list">${rows || '<p class="muted">No recent activity yet.</p>'}</div>
</section>`;
}

function renderOverviewDashboard({
    client = {},
    guild = null,
    grouped = [],
    ticketRecords = [],
    tempVoiceChannels = [],
    moderationCases = [],
    musicSummary = {},
    commandStats = [],
    logs = [],
    voiceActivity = [],
    health = null,
    now = Date.now(),
} = {}) {
    const tickets = summarizeTickets(ticketRecords, now);
    const schedulers = summarizeSchedulers(client);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const activeMusicSessions = musicSummary.current || musicSummary.tracks?.length ? 1 : 0;
    const gatewayPing = Number(client.ws?.ping);
    const databaseStatus = health
        ? (health.databaseReadable ? (health.databaseWritable === false ? 'Read-only' : 'Healthy') : 'Unreachable')
        : 'Unknown';

    const status = `<section class="grid status-grid">
${renderMetric('Bot', client.isReady?.() ? 'Online' : 'Offline')}
${renderMetric('Gateway', Number.isFinite(gatewayPing) && gatewayPing >= 0 ? `${Math.round(gatewayPing)}ms` : 'Unknown')}
${renderMetric('Uptime', formatDuration(process.uptime?.() || 0))}
${renderMetric('Database', databaseStatus)}
${renderMetric('Scheduler', schedulers.healthy ? 'Healthy' : 'Degraded', `${schedulers.running}/${schedulers.total} running`)}
</section>`;

    const operations = `<section class="grid">
${renderMetric('Servers', client.guilds?.cache?.size || 0)}
${renderMetric('Members', getGuildMemberCount(guild))}
${renderMetric('Open Tickets', tickets.open, `${tickets.unclaimed} unclaimed`)}
${renderMetric('Temporary Voice', tempVoiceChannels.length)}
${renderMetric('Music Sessions', activeMusicSessions)}
${renderMetric('Cases Today', moderationCases.filter(item => Number(item.createdAt || 0) >= todayStart.getTime()).length)}
${renderMetric('Commands 30d', commandStats.length)}
${renderMetric('Modules', grouped.length)}
</section>`;

    return `${status}${operations}<section class="grid">${renderRecentActivity({ ticketRecords, moderationCases, tempVoiceChannels, voiceActivity, logs })}</section>`;
}

function renderTicketDashboard(ticketRecords = [], ticketTranscripts = [], now = Date.now()) {
    const summary = summarizeTickets(ticketRecords, now);
    const rows = ticketRecords.slice(0, 30).map(item => `<tr>
<td>${escapeHtml(item.channelId || 'Unknown')}</td>
<td>${escapeHtml(item.openerTag || item.openerId || 'Unknown')}</td>
<td>${escapeHtml(item.claimedByTag || item.claimedById || 'Unclaimed')}</td>
<td>${statusPill(item.status || 'open', isTicketOpen(item) ? 'good' : 'muted')}</td>
<td>${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</td>
</tr>`).join('');

    const transcriptRows = ticketTranscripts.slice(0, 12).map(item => `<div class="row">
<span><strong>${escapeHtml(item.ticketName || item.channelName || item.channelId)}</strong><br><span class="muted">${escapeHtml(item.messageCount || 0)} messages</span></span>
<a class="button secondary" href="/transcripts/${encodeURIComponent(item.id)}">Open</a>
</div>`).join('');

    return `<section class="grid">
${renderMetric('Open Tickets', summary.open)}
${renderMetric('Claimed', summary.claimed)}
${renderMetric('Unclaimed', summary.unclaimed)}
${renderMetric('Recently Closed', summary.recentlyClosed)}
</section>
<section class="grid">
<div class="panel wide"><h2>Open Tickets</h2><div class="table-wrap"><table class="dashboard-table"><thead><tr><th>Channel</th><th>Opened by</th><th>Claimed by</th><th>Status</th><th>Updated</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No ticket records yet.</td></tr>'}</tbody></table></div></div>
<div class="panel side"><h2>Recent Transcripts</h2>${transcriptRows || '<p class="muted">No transcripts have been generated yet.</p>'}</div>
</section>`;
}

function renderVoiceDashboard(tempVoiceChannels = [], voiceActivity = [], guild = null) {
    const rows = tempVoiceChannels.map(item => {
        const channel = getChannel(guild, item.channelId);
        const userLimit = channel?.userLimit || item.userLimit || 0;
        const users = getHumanMemberCount(channel);

        return `<tr>
<td>${escapeHtml(channelDisplay(guild, item.channelId, item.name || 'Unknown'))}</td>
<td>${escapeHtml(item.ownerId || 'Unknown')}</td>
<td>${escapeHtml(userLimit ? `${users} / ${userLimit}` : `${users}`)}</td>
<td>${statusPill(item.locked ? 'Locked' : 'Public', item.locked ? 'warning' : 'good')}</td>
<td>${escapeHtml(formatDateTime(item.createdAt))}</td>
</tr>`;
    }).join('');
    const recent = voiceActivity.slice(0, 12).map(item => `<div class="row">
<span>${escapeHtml(item.userTag || item.userId || 'Member')}<br><span class="muted">${escapeHtml(item.type || 'voice')} ${escapeHtml(item.oldChannelId || '-')} -> ${escapeHtml(item.newChannelId || '-')}</span></span>
<span class="muted">${escapeHtml(formatDateTime(item.createdAt))}</span>
</div>`).join('');

    return `<section class="grid">
${renderMetric('Active Channels', tempVoiceChannels.length)}
${renderMetric('Locked', tempVoiceChannels.filter(item => item.locked).length)}
${renderMetric('Public', tempVoiceChannels.filter(item => !item.locked).length)}
${renderMetric('Voice Events', voiceActivity.length)}
</section>
<section class="grid">
<div class="panel wide"><h2>Active Temporary Channels</h2><div class="table-wrap"><table class="dashboard-table"><thead><tr><th>Channel</th><th>Owner</th><th>Users</th><th>Access</th><th>Created</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No active temporary voice channels.</td></tr>'}</tbody></table></div></div>
<div class="panel side"><h2>Voice Activity</h2>${recent || '<p class="muted">No voice activity yet.</p>'}</div>
</section>`;
}

function renderLoggingDashboard(config = {}, guild = null) {
    const logChannels = config.logChannels || {};
    const rows = loggingRows.map(([key, label, fields]) => {
        const selected = fields.map(field => logChannels[field]).find(Boolean) || '';
        const details = fields.map(field => `${field}: ${logChannels[field] ? channelDisplay(guild, logChannels[field]) : 'not set'}`).join(' | ');

        return `<div class="logging-row">
<div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(details)}</small></div>
${statusPill(selected ? channelDisplay(guild, selected) : 'Not configured', selected ? 'good' : 'muted')}
</div>`;
    }).join('');

    return `<section class="panel">
<h2>Logging Map</h2>
<p class="muted">Each category resolves to a configured channel or the default fallback where supported.</p>
<div class="settings-stack">${rows}</div>
</section>`;
}

module.exports = {
    channelDisplay,
    formatDuration,
    renderLoggingDashboard,
    renderModuleDashboard,
    renderOverviewDashboard,
    renderRecentActivity,
    renderTicketDashboard,
    renderVoiceDashboard,
    summarizeTickets,
};
