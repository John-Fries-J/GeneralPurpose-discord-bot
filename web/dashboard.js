const crypto = require('node:crypto');
const express = require('express');
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, getStoredConfig, saveConfig, updateConfig } = require('../utils/config');
const { validateConfig } = require('../utils/configValidation');
const { appendDashboardLog, clearDashboardLogs, readDashboardLogs } = require('../utils/dashboardLogs');
const { getCommandSettings } = require('../utils/features');
const language = require('../utils/language');
const { getCommandAccess, normalizeIdList } = require('../utils/permissions');

const states = new Map();
const sessions = new Map();
const sessionMaxAgeMs = 24 * 60 * 60 * 1000;
const redactedSecret = '[redacted]';
const sensitiveKeys = new Set(['token', 'clientSecret', 'client_secret', 'password', 'secret']);

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

function cleanupExpiringMaps() {
    const now = Date.now();
    for (const [state, expiresAt] of states.entries()) {
        if (expiresAt <= now) states.delete(state);
    }

    for (const [sessionId, session] of sessions.entries()) {
        if (!session.expiresAt || session.expiresAt <= now) sessions.delete(sessionId);
    }
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
    cleanupExpiringMaps();
    const cookie = parseCookies(req.headers.cookie);
    const session = sessions.get(cookie.dashboard_session);
    if (!session || session.expiresAt <= Date.now()) {
        if (cookie.dashboard_session) sessions.delete(cookie.dashboard_session);
        return null;
    }

    return session;
}

function requireAuth(req, res, next) {
    const session = getSession(req);
    if (!session) return res.redirect('/login');
    req.dashboardSession = session;
    return next();
}

function requireCsrf(req, res, next) {
    const session = req.dashboardSession || getSession(req);
    if (!session || !req.body?._csrf || req.body._csrf !== session.csrfToken) {
        return res.status(403).send('Invalid dashboard request.');
    }

    return next();
}

function isSensitiveKey(key) {
    return sensitiveKeys.has(String(key));
}

function redactSensitiveConfig(value, key = '') {
    if (Array.isArray(value)) {
        return value.map(item => redactSensitiveConfig(item));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            redactSensitiveConfig(childValue, childKey),
        ]));
    }

    if (isSensitiveKey(key) && typeof value === 'string' && value) {
        return redactedSecret;
    }

    return value;
}

function restoreRedactedSecrets(submitted, current) {
    if (Array.isArray(submitted)) {
        return submitted.map((item, index) => restoreRedactedSecrets(item, current?.[index]));
    }

    if (submitted && typeof submitted === 'object') {
        return Object.fromEntries(Object.entries(submitted).map(([key, value]) => [
            key,
            restoreRedactedSecrets(value, current?.[key]),
        ]));
    }

    if (submitted === redactedSecret) {
        return current ?? '';
    }

    return submitted;
}

function csrfInput(session) {
    return `<input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">`;
}

function makeDiscordOauthUrl(settings) {
    cleanupExpiringMaps();
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

function humanize(value) {
    return String(value || '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function slug(value) {
    return String(value || 'section').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function getBotAvatar(client) {
    return client?.user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || '';
}

function getDashboardGuild(client) {
    const settings = getDashboardConfig();
    return settings.guildId ? client.guilds?.cache?.get(settings.guildId) : client.guilds?.cache?.first?.();
}

function getSendableChannels(client) {
    const guild = getDashboardGuild(client);
    if (!guild?.channels?.cache) return [];

    const supported = new Set([ChannelType.GuildAnnouncement, ChannelType.GuildText]);
    return [...guild.channels.cache.values()]
        .filter(channel => supported.has(channel.type))
        .filter(channel => channel.permissionsFor?.(guild.members.me)?.has(PermissionFlagsBits.SendMessages) !== false)
        .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name));
}

function getGuildRoles(client) {
    const guild = getDashboardGuild(client);
    if (!guild?.roles?.cache) return [];

    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
}

function getLanguageSectionsForCategory(category) {
    const mapping = {
        config: ['general', 'status'],
        moderation: ['moderation', 'general'],
        suggestions: ['suggestions'],
        ticket: ['tickets'],
        utility: ['help', 'welcome', 'general'],
    };

    return mapping[category] || [];
}

function formatIdList(value) {
    return normalizeIdList(value).join(', ');
}

function renderLayout(title, body, user = null, client = null, active = 'overview') {
    const avatar = getBotAvatar(client);
    const botName = client?.user?.username || 'Bot Dashboard';
    const navItems = [
        ['overview', 'Overview', '/#overview'],
        ['modules', 'Modules', '/#modules'],
        ['sender', 'Sender', '/#sender'],
        ['config', 'Config', '/#config'],
    ];

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${avatar ? `<link rel="icon" href="${escapeHtml(avatar)}">` : ''}
<style>
:root{color-scheme:light;--bg:#f4f7fb;--panel:#ffffff;--panel-2:#f8fafc;--text:#172033;--muted:#667085;--line:#dde5ef;--brand:#5865f2;--brand-2:#0f766e;--danger:#b42318;--shadow:0 16px 40px rgba(15,23,42,.08)}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
a{color:inherit;text-decoration:none}
.shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
.sidebar{position:sticky;top:0;height:100vh;padding:22px;background:#111827;color:white;display:flex;flex-direction:column;gap:22px}
.brand{display:flex;align-items:center;gap:12px}
.brand img{width:44px;height:44px;border-radius:8px;background:#273449}
.brand strong{font-size:15px;display:block}
.brand span{font-size:12px;color:#b9c2d3}
.nav{display:grid;gap:6px}
.nav a{padding:10px 12px;border-radius:8px;color:#d8dee9;font-size:14px}
.nav a:hover,.nav a.active{background:#243044;color:white}
.userbox{margin-top:auto;border-top:1px solid #2c374a;padding-top:16px;font-size:13px;color:#d8dee9}
.userline{display:flex;align-items:center;justify-content:space-between;gap:12px}
.content{min-width:0;padding:28px}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}
h1{margin:0;font-size:28px;letter-spacing:0}
h2{margin:0 0 12px;font-size:18px;letter-spacing:0}
h3{margin:0;font-size:15px;letter-spacing:0}
p{line-height:1.55}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;box-shadow:var(--shadow);margin-bottom:16px}
.metric{grid-column:span 3;min-height:116px}
.wide{grid-column:span 8}.side{grid-column:span 4}.full{grid-column:1/-1}
.metric span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.metric strong{display:block;margin-top:12px;font-size:28px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #edf2f7}
.row:last-child{border-bottom:0}
.module-card{scroll-margin-top:18px}
.module-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.module-link{display:block;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
.module-link strong{display:block;margin-bottom:4px}
.command{border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0;background:#fff}
.command-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.command-title{font-family:Consolas,monospace;font-size:14px}
.access-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
label{display:grid;gap:6px;font-size:13px;color:#344054}
input,select,textarea{width:100%;border:1px solid #cfd8e3;border-radius:8px;padding:9px 10px;font:inherit;background:white;color:var(--text)}
textarea{min-height:120px;font-family:Consolas,monospace;font-size:13px;resize:vertical}
.config-json{min-height:420px}
input[type="checkbox"]{width:20px;height:20px;accent-color:var(--brand)}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#111827;color:white;border:0;border-radius:8px;padding:9px 13px;text-decoration:none;cursor:pointer;font-weight:600}
button.secondary,.button.secondary{background:#eef2f7;color:#182235}
button.success{background:var(--brand-2)}
button.danger{background:var(--danger)}
.button.ghost{background:transparent;color:#d8dee9;border:1px solid #3a4557}
.pillrow{display:flex;flex-wrap:wrap;gap:8px}
.pill{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#eef2ff;color:#30377a;font-size:12px}
.log{font-family:Consolas,monospace;font-size:12px;background:#101828;color:#d9e1ee;padding:12px;border-radius:8px;overflow:auto;max-height:360px}
.log-entry{padding:7px 0;border-bottom:1px solid #263144}
.notice{border-left:4px solid var(--brand);background:#eef2ff;padding:12px;border-radius:8px;margin-bottom:16px}
.split-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.auth-card{max-width:520px;margin:12vh auto;background:white;border:1px solid var(--line);border-radius:8px;padding:24px;box-shadow:var(--shadow)}
@media (max-width:960px){.shell{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.content{padding:18px}.metric,.wide,.side{grid-column:1/-1}.access-grid{grid-template-columns:1fr}.topbar{display:block}}
</style>
</head>
<body>
<div class="shell">
<aside class="sidebar">
<div class="brand">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : ''}<div><strong>${escapeHtml(botName)}</strong><span>Control dashboard</span></div></div>
<nav class="nav">${navItems.map(([key, label, href]) => `<a class="${active === key ? 'active' : ''}" href="${href}">${escapeHtml(label)}</a>`).join('')}</nav>
<div class="userbox">${user ? `<div class="userline"><span>${escapeHtml(user.username)}</span><a class="button ghost" href="/logout">Log out</a></div>` : '<a class="button" href="/login">Log in with Discord</a>'}</div>
</aside>
<main class="content">${body}</main>
</div>
</body>
</html>`;
}

function renderLanguageEditor(section, values, session) {
    return `<form method="post" action="/language-section" class="panel">
${csrfInput(session)}
<input type="hidden" name="section" value="${escapeHtml(section)}">
<h3>${escapeHtml(humanize(section))}</h3>
<p class="muted">Edit response text as JSON. Placeholders such as \${user}, \${channel}, and {count} should be kept where commands use them.</p>
<textarea name="content">${escapeHtml(JSON.stringify(values || {}, null, 4))}</textarea>
<p><button class="success" type="submit">Save ${escapeHtml(humanize(section))}</button></p>
</form>`;
}

function renderAccessForm(command, settings, roles, session) {
    const commandName = command.data.name;
    const access = getCommandAccess(commandName, { commandSettings: settings });
    const roleHint = roles.slice(0, 6).map(role => `${role.name}: ${role.id}`).join(' | ');

    return `<form method="post" action="/command-access" class="access-form">
${csrfInput(session)}
<input type="hidden" name="command" value="${escapeHtml(commandName)}">
<div class="access-grid">
<label>Allowed users<input name="allowUserIds" value="${escapeHtml(formatIdList(access.allowUserIds))}" placeholder="User IDs, comma separated"></label>
<label>Allowed roles<input name="allowRoleIds" value="${escapeHtml(formatIdList(access.allowRoleIds))}" placeholder="Role IDs, comma separated"></label>
<label>Blocked users<input name="denyUserIds" value="${escapeHtml(formatIdList(access.denyUserIds))}" placeholder="User IDs, comma separated"></label>
<label>Blocked roles<input name="denyRoleIds" value="${escapeHtml(formatIdList(access.denyRoleIds))}" placeholder="Role IDs, comma separated"></label>
</div>
${roleHint ? `<p class="muted">Role IDs: ${escapeHtml(roleHint)}</p>` : ''}
<p><button class="secondary" type="submit">Save access</button></p>
</form>`;
}

function renderDashboard(client, session, notice = '') {
    const config = getStoredConfig();
    const redactedConfig = redactSensitiveConfig(config);
    const settings = getCommandSettings(config);
    const grouped = groupCommands(client);
    const languageValues = language.loadLanguage();
    const logs = readDashboardLogs(120);
    const channels = getSendableChannels(client);
    const roles = getGuildRoles(client);
    const avatar = getBotAvatar(client);

    const moduleLinks = grouped.map(([category, commands]) => `
<a class="module-link" href="#module-${escapeHtml(slug(category))}">
<strong>${escapeHtml(humanize(category))}</strong>
<span class="muted">${commands.length} command${commands.length === 1 ? '' : 's'} ${settings.modules[category] === false ? 'disabled' : 'enabled'}</span>
</a>`).join('');

    const commandsHtml = grouped.map(([category, commands]) => `
<section class="panel module-card" id="module-${escapeHtml(slug(category))}">
<div class="module-head">
<div><h2>${escapeHtml(humanize(category))}</h2><p class="muted">${commands.length} command${commands.length === 1 ? '' : 's'} in this module.</p></div>
<form method="post" action="/toggle-module">
${csrfInput(session)}
<input type="hidden" name="module" value="${escapeHtml(category)}">
<label><input type="checkbox" name="enabled" ${settings.modules[category] === false ? '' : 'checked'} onchange="this.form.submit()"> Module enabled</label>
</form>
</div>
${commands.map(command => `
<div class="command">
<div class="command-head">
<div><div class="command-title">/${escapeHtml(command.data.name)}</div><p class="muted">${escapeHtml(command.data.description || 'No description')}</p></div>
<form method="post" action="/toggle-command">
${csrfInput(session)}
<input type="hidden" name="command" value="${escapeHtml(command.data.name)}">
<label><input type="checkbox" name="enabled" ${settings.commands[command.data.name] === false ? '' : 'checked'} onchange="this.form.submit()"> Enabled</label>
</form>
</div>
${renderAccessForm(command, settings, roles, session)}
</div>`).join('')}
${getLanguageSectionsForCategory(category).map(section => renderLanguageEditor(section, languageValues[section], session)).join('')}
</section>`).join('');

    const logsHtml = logs.length ? logs.map(log => `
<div class="log-entry"><span class="muted">${escapeHtml(log.at)}</span> ${escapeHtml(log.message)} ${log.type ? `<span class="muted">[${escapeHtml(log.type)}]</span>` : ''}</div>`).join('') : '<div class="muted">No dashboard logs yet.</div>';

    const channelOptions = channels.map(channel => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`).join('');
    const rolePills = roles.slice(0, 20).map(role => `<span class="pill">${escapeHtml(role.name)} ${escapeHtml(role.id)}</span>`).join('');

    return renderLayout('Bot Dashboard', `
${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
<div class="topbar" id="overview">
<div><h1>Dashboard</h1><p class="muted">Manage modules, responses, command access, and bot messages from one place.</p></div>
<div class="split-actions">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" style="width:46px;height:46px;border-radius:8px">` : ''}<a class="button secondary" href="/logout">Log out</a></div>
</div>
<section class="grid">
<div class="panel metric"><span>Modules</span><strong>${grouped.length}</strong></div>
<div class="panel metric"><span>Commands</span><strong>${[...client.commands.values()].length}</strong></div>
<div class="panel metric"><span>Sendable channels</span><strong>${channels.length}</strong></div>
<div class="panel metric"><span>Roles cached</span><strong>${roles.length}</strong></div>
</section>
<section class="grid">
<div class="panel wide" id="modules">
<h2>Modules</h2>
<p class="muted">Click a module to jump into command toggles, access rules, and related response text.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${moduleLinks}</div>
</div>
<section class="panel side">
<h2>Logs</h2>
<div class="log">${logsHtml}</div>
<form method="post" action="/logs/clear" style="margin-top:12px">${csrfInput(session)}<button class="danger" type="submit">Clear logs</button></form>
</section>
</section>
<section class="panel" id="sender">
<h2>Message Sender</h2>
<p class="muted">Send a plain message or a simple embed as the bot.</p>
<form method="post" action="/send-message">
${csrfInput(session)}
<div class="access-grid">
<label>Channel<select name="channelId" required>${channelOptions || '<option value="">No sendable channels cached</option>'}</select></label>
<label>Embed title<input name="embedTitle" maxlength="256" placeholder="Optional"></label>
</div>
<label>Message<textarea name="content" maxlength="2000" placeholder="Message content"></textarea></label>
<label>Embed description<textarea name="embedDescription" maxlength="4000" placeholder="Optional"></textarea></label>
<p><button class="success" type="submit">Send through bot</button></p>
</form>
</section>
${rolePills ? `<section class="panel"><h2>Role Reference</h2><div class="pillrow">${rolePills}</div></section>` : ''}
<section>${commandsHtml}</section>
<section class="panel">
<h2>All Language</h2>
<p class="muted">For broad edits, update the full language file here. Module cards above expose the common response groups.</p>
<form method="post" action="/language-json">
${csrfInput(session)}
<textarea class="config-json" name="language">${escapeHtml(JSON.stringify(languageValues, null, 4))}</textarea>
<p><button class="success" type="submit">Save language.json</button></p>
</form>
</section>
<section class="panel" id="config">
<h2>Config</h2>
<p class="muted">This edits config.json directly. Sensitive values are redacted and preserved if left unchanged.</p>
<form method="post" action="/config-json">
${csrfInput(session)}
<textarea class="config-json" name="config">${escapeHtml(JSON.stringify(redactedConfig, null, 4))}</textarea>
<p><button type="submit">Save config</button></p>
</form>
</section>`, session.user, client);
}

function startDashboard(client) {
    const settings = getDashboardConfig();
    if (!settings.enabled) return null;

    const app = express();
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    });

    app.get('/health', (req, res) => res.json({
        ok: true,
        discordReady: client.isReady?.() === true,
        guilds: client.guilds?.cache?.size || 0,
        uptimeSeconds: Math.floor(process.uptime()),
    }));

    app.get('/login', (req, res) => {
        const currentSettings = getDashboardConfig();
        if (!currentSettings.oauth.clientId || !currentSettings.oauth.clientSecret) {
            return res.send(renderLayout('Dashboard setup required', '<section class="auth-card"><h2>OAuth setup required</h2><p>Add dashboard.oauth.clientId and dashboard.oauth.clientSecret to config.json, or set DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET.</p></section>', null, client));
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
            sessions.set(sessionId, {
                user,
                createdAt: Date.now(),
                expiresAt: Date.now() + sessionMaxAgeMs,
                csrfToken: crypto.randomBytes(32).toString('hex'),
            });
            appendDashboardLog('Dashboard login', { userId: user.id });
            const secureCookie = currentSettings.publicUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
            res.setHeader('Set-Cookie', `dashboard_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secureCookie ? '; Secure' : ''}`);
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

    app.get('/', requireAuth, (req, res) => res.send(renderDashboard(client, req.dashboardSession, req.query.message || '')));

    app.post('/toggle-module', requireAuth, requireCsrf, (req, res) => {
        const enabled = req.body.enabled === 'on';
        updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.modules = config.commandSettings.modules || {};
            config.commandSettings.modules[req.body.module] = enabled;
            return config;
        });
        appendDashboardLog('Module toggle updated', { module: req.body.module, enabled, userId: req.dashboardSession.user.id });
        res.redirect(`/#module-${slug(req.body.module)}`);
    });

    app.post('/toggle-command', requireAuth, requireCsrf, (req, res) => {
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

    app.post('/command-access', requireAuth, requireCsrf, (req, res) => {
        const commandName = req.body.command;
        const access = {
            allowRoleIds: normalizeIdList(req.body.allowRoleIds),
            allowUserIds: normalizeIdList(req.body.allowUserIds),
            denyRoleIds: normalizeIdList(req.body.denyRoleIds),
            denyUserIds: normalizeIdList(req.body.denyUserIds),
        };

        updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.access = config.commandSettings.access || {};

            if (Object.values(access).every(list => list.length === 0)) {
                delete config.commandSettings.access[commandName];
            } else {
                config.commandSettings.access[commandName] = access;
            }

            return config;
        });

        appendDashboardLog('Command access updated', { command: commandName, userId: req.dashboardSession.user.id });
        res.redirect('/');
    });

    app.post('/language-section', requireAuth, requireCsrf, (req, res) => {
        try {
            const section = req.body.section;
            const parsed = JSON.parse(req.body.content || '{}');
            if (!section || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Language section must be a JSON object.');
            }

            const currentLanguage = language.loadLanguage();
            currentLanguage[section] = parsed;
            language.saveLanguage(currentLanguage);
            appendDashboardLog('Language section saved', { section, userId: req.dashboardSession.user.id });
            res.redirect('/');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(error.message)}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/language-json', requireAuth, requireCsrf, (req, res) => {
        try {
            const parsed = JSON.parse(req.body.language);
            language.saveLanguage(parsed);
            appendDashboardLog('language.json saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/?message=language.json%20saved#modules');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(error.message)}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/send-message', requireAuth, requireCsrf, async (req, res) => {
        try {
            const channel = await client.channels.fetch(req.body.channelId).catch(() => null);
            if (!channel?.send) {
                return res.status(400).send(renderLayout('Message not sent', '<section class="panel"><h2>Message not sent</h2><p>I could not find a sendable channel.</p></section>', req.dashboardSession.user, client));
            }

            const content = String(req.body.content || '').trim();
            const embedTitle = String(req.body.embedTitle || '').trim();
            const embedDescription = String(req.body.embedDescription || '').trim();
            const payload = {};

            if (content) payload.content = content;
            if (embedTitle || embedDescription) {
                const embed = new EmbedBuilder().setColor(0x5865f2);
                if (embedTitle) embed.setTitle(embedTitle);
                if (embedDescription) embed.setDescription(embedDescription);
                payload.embeds = [embed];
            }

            if (!payload.content && !payload.embeds) {
                return res.status(400).send(renderLayout('Message not sent', '<section class="panel"><h2>Message not sent</h2><p>Add message content or embed text before sending.</p></section>', req.dashboardSession.user, client));
            }

            await channel.send(payload);
            appendDashboardLog('Dashboard message sent', { channelId: channel.id, userId: req.dashboardSession.user.id });
            res.redirect('/?message=Message%20sent#sender');
        } catch (error) {
            console.error('Dashboard message send failed:', error);
            res.status(500).send(renderLayout('Message failed', '<section class="panel"><h2>Message failed</h2><p>Discord rejected the message. Check the bot permissions and message content.</p></section>', req.dashboardSession.user, client));
        }
    });

    app.post('/config-json', requireAuth, requireCsrf, (req, res) => {
        try {
            const parsedConfig = JSON.parse(req.body.config);
            const restoredConfig = restoreRedactedSecrets(parsedConfig, getStoredConfig());
            const errors = validateConfig(restoredConfig);
            if (errors.length) {
                const items = errors.map(error => `<li>${escapeHtml(error)}</li>`).join('');
                return res.status(400).send(renderLayout('Invalid config', `<section class="panel"><h2>Invalid config</h2><ul>${items}</ul><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
            }

            saveConfig(restoredConfig);
            appendDashboardLog('Config saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/');
        } catch {
            res.status(400).send(renderLayout('Invalid JSON', '<section class="panel"><h2>Invalid JSON</h2><p>The config was not saved. Use the browser back button and fix the JSON.</p></section>', req.dashboardSession.user, client));
        }
    });

    app.post('/logs/clear', requireAuth, requireCsrf, (req, res) => {
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
    redactSensitiveConfig,
    restoreRedactedSecrets,
    startDashboard,
};
