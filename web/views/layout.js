const { escapeHtml } = require('./components/html');

const dashboardNavSections = [
    {
        label: '',
        items: [
            ['overview', 'Overview', '/'],
        ],
    },
    {
        label: 'Server',
        items: [
            ['modules', 'Modules', '/modules'],
            ['config', 'Configuration', '/config'],
            ['commands', 'Commands', '/commands'],
        ],
    },
    {
        label: 'Community',
        items: [
            ['community', 'Community', '/community'],
            ['leveling', 'Leveling', '/leveling'],
        ],
    },
    {
        label: 'Moderation',
        items: [
            ['moderation', 'Moderation', '/moderation'],
            ['tickets', 'Tickets', '/tickets'],
            ['logs', 'Logs', '/logs'],
            ['audit', 'Audit', '/audit'],
        ],
    },
    {
        label: 'Voice',
        items: [
            ['voice', 'Temporary Voice', '/voice'],
            ['music', 'Music', '/music'],
        ],
    },
    {
        label: 'Integrations',
        items: [
            ['media', 'YouTube / Twitch', '/media'],
        ],
    },
    {
        label: 'System',
        items: [
            ['health', 'Health', '/health-page'],
            ['analytics', 'Analytics', '/analytics'],
            ['language', 'Language', '/language'],
            ['sender', 'Sender', '/sender'],
            ['backups', 'Backups', '/backups'],
        ],
    },
];

function getBotAvatar(client) {
    return client?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
}

function getConnectionLabel(client) {
    if (!client?.isReady?.()) return 'Starting';
    const ping = Number(client.ws?.ping);
    return Number.isFinite(ping) && ping >= 0 ? `Online - ${Math.round(ping)}ms` : 'Online';
}

function renderNav(active) {
    return dashboardNavSections.map(section => `
${section.label ? `<div class="nav-section">${escapeHtml(section.label)}</div>` : ''}
${section.items.map(([key, label, href]) => `<a class="${active === key ? 'active' : ''}" href="${href}">${escapeHtml(label)}</a>`).join('')}`).join('');
}

function renderLayout(title, body, user = null, client = null, active = 'overview', options = {}) {
    const avatar = getBotAvatar(client);
    const botName = client?.user?.username || 'Bot Dashboard';
    const guild = options.guild;
    const guildName = guild?.name || options.guildName || 'No server selected';
    const connection = options.connection || getConnectionLabel(client);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${avatar ? `<link rel="icon" href="${escapeHtml(avatar)}">` : ''}
<script>
const savedTheme = localStorage.getItem('dashboard-theme');
const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = savedTheme || (systemDark ? 'dark' : 'light');
</script>
<link rel="stylesheet" href="/dashboard.css">
<script defer src="/dashboard.js"></script>
</head>
<body>
<div class="shell">
<aside class="sidebar">
<div class="brand">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : '<div class="brand-mark">GP</div>'}<div><strong>${escapeHtml(botName)}</strong><span>${escapeHtml(connection)}</span></div></div>
<div class="server-chip"><span>Server</span><strong>${escapeHtml(guildName)}</strong></div>
<nav class="nav" aria-label="Dashboard navigation">${renderNav(active)}</nav>
<button class="button ghost" type="button" data-theme-toggle>Toggle theme</button>
<div class="userbox">${user ? `<div class="userline"><span>${escapeHtml(user.username)}</span><a class="button ghost" href="/logout">Log out</a></div>` : '<a class="button" href="/login">Log in with Discord</a>'}</div>
</aside>
<main class="content">${body}</main>
</div>
</body>
</html>`;
}

module.exports = {
    dashboardNavSections,
    getBotAvatar,
    renderLayout,
    renderNav,
};
