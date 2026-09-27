const crypto = require('node:crypto');
const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const { getConfig, saveConfig, updateConfig } = require('../utils/config');
const { appendDashboardLog, clearDashboardLogs, readDashboardLogs } = require('../utils/dashboardLogs');
const { getCommandSettings } = require('../utils/features');

const states = new Map();
const sessions = new Map();

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const index = part.indexOf('=');
            if (index === -1) return [part, ''];
            return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
        }));
}

function getDashboardConfig() {
    const config = getConfig();
    return {
        enabled: config.dashboard?.enabled === true,
        host: process.env.DASHBOARD_HOST || config.dashboard?.host || '0.0.0.0',
        port: Number(process.env.DASHBOARD_PORT || config.dashboard?.port || 3000),
        publicUrl: process.env.DASHBOARD_PUBLIC_URL || config.dashboard?.publicUrl || `http://localhost:${config.dashboard?.port || 3000}`,
        oauth: {
            clientId: process.env.DISCORD_OAUTH_CLIENT_ID || config.dashboard?.oauth?.clientId || config.clientId,
            clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET || config.dashboard?.oauth?.clientSecret,
            redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI || config.dashboard?.oauth?.redirectUri,
        },
        guildId: config.dashboard?.guildId || config.guildId,
    };
}

function getSession(req) {
    const cookie = parseCookies(req.headers.cookie);
    return sessions.get(cookie.dashboard_session) || null;
}

function requireAuth(req, res, next) {
    const session = getSession(req);
    if (!session) return res.redirect('/login');
    req.dashboardSession = session;
    return next();
}

function makeDiscordOauthUrl(settings) {
    const state = crypto.randomBytes(24).toString('hex');
    states.set(state, Date.now() + 10 * 60 * 1000);

    const redirectUri = settings.oauth.redirectUri || `${settings.publicUrl.replace(/\/$/, '')}/auth/discord/callback`;
    const params = new URLSearchParams({
        client_id: settings.oauth.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state,
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeDiscordCode(settings, code) {
    const redirectUri = settings.oauth.redirectUri || `${settings.publicUrl.replace(/\/$/, '')}/auth/discord/callback`;
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: settings.oauth.clientId,
            client_secret: settings.oauth.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        }),
    });

    if (!tokenResponse.ok) throw new Error(`Discord token exchange failed with ${tokenResponse.status}`);
    return tokenResponse.json();
}

async function fetchDiscordUser(accessToken) {
    const [userResponse, guildsResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);

    if (!userResponse.ok || !guildsResponse.ok) throw new Error('Discord profile lookup failed');

    return {
        user: await userResponse.json(),
        guilds: await guildsResponse.json(),
    };
}

function canManageDashboard(discordUser, guilds, settings) {
    const config = getConfig();
    if (config.devs?.includes(discordUser.id)) return true;

    const guild = guilds.find(item => item.id === settings.guildId);
    if (!guild) return false;

    const permissions = BigInt(guild.permissions || 0);
    return (permissions & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
}

function groupCommands(client) {
    const grouped = new Map();
    for (const command of client.commands.values()) {
        const category = command.category || 'uncategorized';
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(command);
    }

    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderLayout(title, body, user = null) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#111827}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#111827;color:white}
main{max-width:1120px;margin:0 auto;padding:24px}
a{color:#2563eb}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.panel{background:white;border:1px solid #d1d5db;border-radius:8px;padding:16px;margin-bottom:16px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eef2f7}
.row:last-child{border-bottom:0}
button,.button{background:#111827;color:white;border:0;border-radius:6px;padding:8px 12px;text-decoration:none;cursor:pointer}
button.secondary{background:#4b5563}
textarea{width:100%;min-height:420px;font-family:Consolas,monospace;font-size:13px;box-sizing:border-box}
input[type="checkbox"]{width:18px;height:18px}
.muted{color:#6b7280}
.log{font-family:Consolas,monospace;font-size:12px;background:#0f172a;color:#d1d5db;padding:10px;border-radius:6px;overflow:auto}
.log-entry{padding:6px 0;border-bottom:1px solid #243044}
.danger{background:#991b1b}
</style>
</head>
<body>
<header><strong>Bot Dashboard</strong><span>${user ? `${escapeHtml(user.username)} <a class="button" href="/logout">Logout</a>` : ''}</span></header>
<main>${body}</main>
</body>
</html>`;
}

function renderDashboard(client, session) {
    const config = getConfig();
    const settings = getCommandSettings(config);
    const grouped = groupCommands(client);
    const logs = readDashboardLogs(120);

    const modulesHtml = grouped.map(([category]) => `
<form class="row" method="post" action="/toggle-module">
<input type="hidden" name="module" value="${escapeHtml(category)}">
<span><strong>${escapeHtml(category)}</strong></span>
<label><input type="checkbox" name="enabled" ${settings.modules[category] === false ? '' : 'checked'} onchange="this.form.submit()"> Enabled</label>
</form>`).join('');

    const commandsHtml = grouped.map(([category, commands]) => `
<div class="panel"><h3>${escapeHtml(category)}</h3>${commands.map(command => `
<form class="row" method="post" action="/toggle-command">
<input type="hidden" name="command" value="${escapeHtml(command.data.name)}">
<span>/${escapeHtml(command.data.name)}</span>
<label><input type="checkbox" name="enabled" ${settings.commands[command.data.name] === false ? '' : 'checked'} onchange="this.form.submit()"> Enabled</label>
</form>`).join('')}</div>`).join('');

    const logsHtml = logs.length ? logs.map(log => `
<div class="log-entry"><span class="muted">${escapeHtml(log.at)}</span> ${escapeHtml(log.message)} ${log.type ? `<span class="muted">[${escapeHtml(log.type)}]</span>` : ''}</div>`).join('') : '<div class="muted">No dashboard logs yet.</div>';

    return renderLayout('Bot Dashboard', `
<div class="grid">
<section class="panel">
<h2>Modules</h2>
<p class="muted">Toggles update config immediately. Restart or wait for command refresh to update Discord's slash command list.</p>
${modulesHtml}
</section>
<section class="panel">
<h2>Logs</h2>
<div class="log">${logsHtml}</div>
<form method="post" action="/logs/clear" style="margin-top:12px"><button class="danger" type="submit">Clear logs</button></form>
</section>
</div>
<section>
<h2>Commands</h2>
${commandsHtml}
</section>
<section class="panel">
<h2>Config</h2>
<p class="muted">This edits config.json directly. Keep valid JSON.</p>
<form method="post" action="/config-json">
<textarea name="config">${escapeHtml(JSON.stringify(config, null, 4))}</textarea>
<p><button type="submit">Save config</button></p>
</form>
</section>`, session.user);
}

function startDashboard(client) {
    const settings = getDashboardConfig();
    if (!settings.enabled) return null;

    const app = express();
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));

    app.get('/health', (req, res) => res.json({ ok: true }));

    app.get('/login', (req, res) => {
        const currentSettings = getDashboardConfig();
        if (!currentSettings.oauth.clientId || !currentSettings.oauth.clientSecret) {
            return res.send(renderLayout('Dashboard setup required', '<section class="panel"><h2>OAuth setup required</h2><p>Add dashboard.oauth.clientId and dashboard.oauth.clientSecret to config.json, or set DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET.</p></section>'));
        }

        return res.redirect(makeDiscordOauthUrl(currentSettings));
    });

    app.get('/auth/discord/callback', async (req, res) => {
        try {
            const expiry = states.get(req.query.state);
            states.delete(req.query.state);
            if (!expiry || expiry < Date.now()) return res.status(403).send('Invalid OAuth state.');

            const currentSettings = getDashboardConfig();
            const token = await exchangeDiscordCode(currentSettings, req.query.code);
            const { user, guilds } = await fetchDiscordUser(token.access_token);
            if (!canManageDashboard(user, guilds, currentSettings)) return res.status(403).send('You are not allowed to manage this dashboard.');

            const sessionId = crypto.randomBytes(32).toString('hex');
            sessions.set(sessionId, { user, createdAt: Date.now() });
            appendDashboardLog('Dashboard login', { userId: user.id });
            res.setHeader('Set-Cookie', `dashboard_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
            return res.redirect('/');
        } catch (error) {
            console.error('Dashboard OAuth failed:', error);
            return res.status(500).send('Discord OAuth failed. Check the dashboard OAuth settings.');
        }
    });

    app.get('/logout', (req, res) => {
        const cookie = parseCookies(req.headers.cookie);
        sessions.delete(cookie.dashboard_session);
        res.setHeader('Set-Cookie', 'dashboard_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        res.redirect('/login');
    });

    app.get('/', requireAuth, (req, res) => res.send(renderDashboard(client, req.dashboardSession)));

    app.post('/toggle-module', requireAuth, (req, res) => {
        const enabled = req.body.enabled === 'on';
        updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.modules = config.commandSettings.modules || {};
            config.commandSettings.modules[req.body.module] = enabled;
            return config;
        });
        appendDashboardLog('Module toggle updated', { module: req.body.module, enabled, userId: req.dashboardSession.user.id });
        res.redirect('/');
    });

    app.post('/toggle-command', requireAuth, (req, res) => {
        const enabled = req.body.enabled === 'on';
        updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.commands = config.commandSettings.commands || {};
            config.commandSettings.commands[req.body.command] = enabled;
            return config;
        });
        appendDashboardLog('Command toggle updated', { command: req.body.command, enabled, userId: req.dashboardSession.user.id });
        res.redirect('/');
    });

    app.post('/config-json', requireAuth, (req, res) => {
        try {
            saveConfig(JSON.parse(req.body.config));
            appendDashboardLog('Config saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/');
        } catch {
            res.status(400).send(renderLayout('Invalid JSON', '<section class="panel"><h2>Invalid JSON</h2><p>The config was not saved. Use the browser back button and fix the JSON.</p></section>', req.dashboardSession.user));
        }
    });

    app.post('/logs/clear', requireAuth, (req, res) => {
        clearDashboardLogs();
        appendDashboardLog('Dashboard logs cleared', { userId: req.dashboardSession.user.id });
        res.redirect('/');
    });

    const server = app.listen(settings.port, settings.host, () => {
        console.log(`[DASHBOARD] Listening on ${settings.publicUrl}`);
        appendDashboardLog('Dashboard started', { url: settings.publicUrl });
    });

    return server;
}

module.exports = {
    startDashboard,
};
