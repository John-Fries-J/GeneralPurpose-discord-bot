const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, getStoredConfig, saveConfig, updateConfig } = require('../utils/config');
const { validateConfig } = require('../utils/configValidation');
const { appendDashboardLog, clearDashboardLogs, readDashboardLogs } = require('../utils/dashboardLogs');
const { getCommandSettings } = require('../utils/features');
const language = require('../utils/language');
const { getCommandAccess, normalizeIdList } = require('../utils/permissions');
const {
    createScheduledMessage,
    deleteEmbedTemplate,
    listCommandStats,
    listEmbedTemplates,
    listModerationCases,
    listModNotes,
    listScheduledMessages,
    listTempVoiceChannelsForGuild,
    listTicketRecords,
    listTicketTranscripts,
    listVoiceActivity,
    getTicketTranscript,
    readState,
    upsertEmbedTemplate,
} = require('../utils/store');

const states = new Map();
const sessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const redactedSecret = '[redacted]';
const sensitiveKeys = new Set(['token', 'apiKey', 'clientSecret', 'client_secret', 'password', 'secret']);

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

function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
    const config = getConfig();
    return process.env.DASHBOARD_SESSION_SECRET
        || config.dashboard?.sessionSecret
        || config.dashboard?.oauth?.clientSecret
        || config.token
        || 'development-dashboard-session-secret';
}

function signValue(value) {
    return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createSessionToken(session) {
    const payload = base64UrlEncode(JSON.stringify(session));
    return `${payload}.${signValue(payload)}`;
}

function verifySessionToken(token) {
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    const expectedSignature = signValue(payload);

    try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
        const session = JSON.parse(base64UrlDecode(payload));
        if (!session?.expiresAt || session.expiresAt <= Date.now()) return null;
        return session;
    } catch {
        return null;
    }
}

function getSession(req) {
    cleanupExpiringMaps();
    const cookie = parseCookies(req.headers.cookie);
    return verifySessionToken(cookie.dashboard_session);
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

async function canViewTranscript(client, session, transcript) {
    const config = getConfig();
    if (!session?.user || !transcript) return false;
    if (config.devs?.includes(session.user.id)) return true;
    if (transcript.allowedUserIds?.includes(session.user.id)) return true;

    const guild = client.guilds.cache.get(transcript.guildId) || getDashboardGuild(client);
    const member = await guild?.members?.fetch(session.user.id).catch(() => null);
    if (!member) return false;

    if (member.permissions?.has(PermissionFlagsBits.ManageGuild) || member.permissions?.has(PermissionFlagsBits.ManageMessages)) {
        return true;
    }

    const supportRoleId = config.tickets?.supportRoleId || config.ticketRole;
    return Boolean(supportRoleId && member.roles?.cache?.has(supportRoleId));
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

function parseEmbedColor(value) {
    const color = String(value || '').trim();
    if (!color) return 0x5865f2;
    if (/^#[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16);
    if (/^[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color, 16);
    return 0x5865f2;
}

function parseEmbedFields(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [name, ...rest] = line.split('|');
            return {
                name: (name || 'Field').trim().slice(0, 256),
                value: (rest.join('|') || 'No value').trim().slice(0, 1024),
                inline: false,
            };
        })
        .slice(0, 25);
}

function buildDashboardMessagePayload(body) {
    const content = String(body.content || '').trim();
    const embedTitle = String(body.embedTitle || '').trim();
    const embedDescription = String(body.embedDescription || '').trim();
    const embedUrl = String(body.embedUrl || '').trim();
    const embedThumbnail = String(body.embedThumbnail || '').trim();
    const embedImage = String(body.embedImage || '').trim();
    const embedFooter = String(body.embedFooter || '').trim();
    const embedFields = parseEmbedFields(body.embedFields);
    const hasEmbed = embedTitle || embedDescription || embedUrl || embedThumbnail || embedImage || embedFooter || embedFields.length;
    const payload = {};

    if (content) payload.content = content;
    if (hasEmbed) {
        const embed = {
            color: parseEmbedColor(body.embedColor),
            title: embedTitle,
            description: embedDescription,
            url: embedUrl,
            thumbnail: embedThumbnail,
            image: embedImage,
            footer: embedFooter,
            fields: embedFields,
        };
        payload.embed = embed;
        payload.embeds = [new EmbedBuilder().setColor(embed.color)];
        if (embed.title) payload.embeds[0].setTitle(embed.title);
        if (embed.description) payload.embeds[0].setDescription(embed.description);
        if (embed.url) payload.embeds[0].setURL(embed.url);
        if (embed.thumbnail) payload.embeds[0].setThumbnail(embed.thumbnail);
        if (embed.image) payload.embeds[0].setImage(embed.image);
        if (embed.footer) payload.embeds[0].setFooter({ text: embed.footer });
        if (embed.fields.length) payload.embeds[0].addFields(embed.fields);
    }

    return payload;
}

function buildEmbedFromTemplate(embed) {
    if (!embed) return null;

    const builder = new EmbedBuilder();
    if (embed.color) builder.setColor(embed.color);
    if (embed.title) builder.setTitle(embed.title);
    if (embed.description) builder.setDescription(embed.description);
    if (embed.url) builder.setURL(embed.url);
    if (embed.thumbnail) builder.setThumbnail(embed.thumbnail);
    if (embed.image) builder.setImage(embed.image);
    if (embed.footer) builder.setFooter({ text: embed.footer });
    if (Array.isArray(embed.fields) && embed.fields.length) builder.addFields(embed.fields.slice(0, 25));
    return builder;
}

function getEditableLanguageValues(source) {
    const { watermark, ...editable } = source;
    return editable;
}

function renderLayout(title, body, user = null, client = null, active = 'overview') {
    const avatar = getBotAvatar(client);
    const botName = client?.user?.username || 'Bot Dashboard';
    const navItems = [
        ['overview', 'Overview', '/'],
        ['audit', 'Audit', '/audit'],
        ['analytics', 'Analytics', '/analytics'],
        ['health', 'Health', '/health-page'],
        ['modules', 'Modules', '/modules'],
        ['commands', 'Commands', '/commands'],
        ['moderation', 'Moderation', '/moderation'],
        ['tickets', 'Tickets', '/tickets'],
        ['community', 'Community', '/community'],
        ['leveling', 'Leveling', '/leveling'],
        ['voice', 'Voice', '/voice'],
        ['media', 'Media', '/media'],
        ['music', 'Music', '/music'],
        ['language', 'Language', '/language'],
        ['sender', 'Sender', '/sender'],
        ['config', 'Config', '/config'],
        ['backups', 'Backups', '/backups'],
        ['logs', 'Logs', '/logs'],
    ];

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
<style>
:root{color-scheme:light;--bg:#f4f7fb;--panel:#ffffff;--panel-2:#f8fafc;--text:#172033;--muted:#667085;--line:#dde5ef;--brand:#5865f2;--brand-2:#0f766e;--danger:#b42318;--shadow:0 16px 40px rgba(15,23,42,.08)}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0b1120;--panel:#111827;--panel-2:#182235;--text:#eef4ff;--muted:#a6b0c3;--line:#2c374a;--brand:#8ea2ff;--brand-2:#2dd4bf;--danger:#fb7185;--shadow:0 18px 48px rgba(0,0,0,.32)}
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
.module-card.is-collapsed .module-body{display:none}
.module-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.module-link{display:block;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
.module-link strong{display:block;margin-bottom:4px}.module-link:hover{border-color:var(--brand);transform:translateY(-1px)}
.command{border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0;background:var(--panel)}
.command.is-hidden{display:none}
.command-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.command-title{font-family:Consolas,monospace;font-size:14px}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.toolbar input{max-width:340px}
.access-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
label{display:grid;gap:6px;font-size:13px;color:var(--text)}
input,select,textarea{width:100%;border:1px solid #cfd8e3;border-radius:8px;padding:9px 10px;font:inherit;background:white;color:var(--text)}
:root[data-theme="dark"] input,:root[data-theme="dark"] select,:root[data-theme="dark"] textarea{background:#0f172a;border-color:#344154;color:var(--text)}
textarea{min-height:120px;font-family:Consolas,monospace;font-size:13px;resize:vertical}
.config-json{min-height:420px}
input[type="checkbox"]{width:20px;height:20px;accent-color:var(--brand)}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#111827;color:white;border:0;border-radius:8px;padding:9px 13px;text-decoration:none;cursor:pointer;font-weight:600}
button.secondary,.button.secondary{background:#eef2f7;color:#182235}:root[data-theme="dark"] button.secondary,:root[data-theme="dark"] .button.secondary{background:#243044;color:#eef4ff}
button.success{background:var(--brand-2)}
button.danger{background:var(--danger)}
.button.ghost{background:transparent;color:#d8dee9;border:1px solid #3a4557}
.pillrow{display:flex;flex-wrap:wrap;gap:8px}
.pill{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#eef2ff;color:#30377a;font-size:12px;border:0}:root[data-theme="dark"] .pill{background:#25304d;color:#dbe5ff}
.log{font-family:Consolas,monospace;font-size:12px;background:#101828;color:#d9e1ee;padding:12px;border-radius:8px;overflow:auto;max-height:360px}
.log-entry{padding:7px 0;border-bottom:1px solid #263144}
.notice{border-left:4px solid var(--brand);background:#eef2ff;padding:12px;border-radius:8px;margin-bottom:16px}:root[data-theme="dark"] .notice{background:#172554}
.preview{border:1px solid var(--line);border-radius:8px;background:var(--panel-2);padding:12px;margin-top:12px}.preview-title{font-weight:700;margin-bottom:6px}.preview-body{white-space:pre-wrap;color:var(--muted)}
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
<button class="button ghost" type="button" data-theme-toggle>Toggle theme</button>
<div class="userbox">${user ? `<div class="userline"><span>${escapeHtml(user.username)}</span><a class="button ghost" href="/logout">Log out</a></div>` : '<a class="button" href="/login">Log in with Discord</a>'}</div>
</aside>
<main class="content">${body}</main>
</div>
<script>
document.querySelectorAll('[data-command-search]').forEach(input => {
    input.addEventListener('input', () => {
        const root = document.querySelector(input.dataset.commandSearch);
        if (!root) return;
        const query = input.value.trim().toLowerCase();
        root.querySelectorAll('.command').forEach(command => {
            command.classList.toggle('is-hidden', query && !command.textContent.toLowerCase().includes(query));
        });
    });
});
document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem('dashboard-theme', nextTheme);
});
document.querySelectorAll('[data-collapse-target]').forEach(button => {
    button.addEventListener('click', () => {
        const target = document.querySelector(button.dataset.collapseTarget);
        if (!target) return;
        target.classList.toggle('is-collapsed');
        button.textContent = target.classList.contains('is-collapsed') ? 'Expand' : 'Collapse';
    });
});
document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(button.dataset.copy);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = button.dataset.copyLabel || 'Copy'; }, 900);
    });
});
document.querySelector('[data-audit-filter]')?.addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-audit-type]').forEach(entry => {
        entry.style.display = !query || entry.textContent.toLowerCase().includes(query) || entry.dataset.auditType.toLowerCase().includes(query) ? '' : 'none';
    });
});
const messageForm = document.querySelector('[data-message-form]');
if (messageForm) {
    const renderPreview = () => {
        const title = messageForm.embedTitle.value.trim() || 'Embed title';
        const description = messageForm.embedDescription.value.trim() || 'Embed description preview';
        const content = messageForm.content.value.trim() || 'Message content preview';
        document.querySelector('[data-preview-content]').textContent = content;
        document.querySelector('[data-preview-title]').textContent = title;
        document.querySelector('[data-preview-body]').textContent = description;
    };
    messageForm.addEventListener('input', renderPreview);
    renderPreview();
}
</script>
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

function renderRoleMultiSelect(name, roles, selectedIds) {
    const selected = new Set(normalizeIdList(selectedIds));
    return `<select name="${escapeHtml(name)}" multiple size="6">
${roles.map(role => `<option value="${escapeHtml(role.id)}" ${selected.has(role.id) ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}
</select>`;
}

function renderAccessForm(command, settings, roles, session) {
    const commandName = command.data.name;
    const access = getCommandAccess(commandName, { commandSettings: settings });

    return `<form method="post" action="/command-access" class="access-form">
${csrfInput(session)}
<input type="hidden" name="command" value="${escapeHtml(commandName)}">
<div class="access-grid">
<label>Allowed users<input name="allowUserIds" value="${escapeHtml(formatIdList(access.allowUserIds))}" placeholder="User IDs, comma separated"></label>
<label>Allowed roles${renderRoleMultiSelect('allowRoleIds', roles, access.allowRoleIds)}</label>
<label>Blocked users<input name="denyUserIds" value="${escapeHtml(formatIdList(access.denyUserIds))}" placeholder="User IDs, comma separated"></label>
<label>Blocked roles${renderRoleMultiSelect('denyRoleIds', roles, access.denyRoleIds)}</label>
</div>
<p><button class="secondary" type="submit">Save access</button></p>
</form>`;
}

function summarizeCounts(items, keySelector, limit = 10) {
    const counts = new Map();
    for (const item of items) {
        const key = keySelector(item);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, limit);
}

function renderCountRows(rows, emptyText = 'No data yet.') {
    return rows.length
        ? rows.map(([label, count]) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong></div>`).join('')
        : `<p class="muted">${escapeHtml(emptyText)}</p>`;
}

function getConfigBackupDirectory() {
    return path.resolve(__dirname, '..', 'data', 'config-backups');
}

function listConfigBackups() {
    const directory = getConfigBackupDirectory();
    if (!fs.existsSync(directory)) return [];

    return fs.readdirSync(directory)
        .filter(file => /^config-\d{4}-\d{2}-\d{2}T/.test(file) && file.endsWith('.json'))
        .map(file => {
            const fullPath = path.join(directory, file);
            return { file, fullPath, createdAt: fs.statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

function createConfigBackup(label = 'manual') {
    const directory = getConfigBackupDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const safeLabel = String(label || 'manual').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'manual';
    const file = `config-${new Date().toISOString().replace(/[:.]/g, '-')}-${safeLabel}.json`;
    const fullPath = path.join(directory, file);
    fs.writeFileSync(fullPath, `${JSON.stringify(getStoredConfig(), null, 4)}\n`);
    return file;
}

function restoreConfigBackup(file) {
    const backup = listConfigBackups().find(item => item.file === file);
    if (!backup) throw new Error('Backup was not found.');

    const parsed = JSON.parse(fs.readFileSync(backup.fullPath, 'utf8'));
    const errors = validateConfig(parsed);
    if (errors.length) throw new Error(errors.join('\n'));
    saveConfig(parsed);
}

function renderJsonEditorPanel(title, description, action, session, object) {
    return `<section class="panel">
<h2>${escapeHtml(title)}</h2>
<p class="muted">${escapeHtml(description)}</p>
<form method="post" action="${escapeHtml(action)}">
${csrfInput(session)}
<textarea class="config-json" name="json">${escapeHtml(JSON.stringify(object || {}, null, 4))}</textarea>
<p><button class="success" type="submit">Save ${escapeHtml(title)}</button></p>
</form>
</section>`;
}

function renderConfigSectionEditor(section, title, description, session, object) {
    return `<section class="panel">
<h2>${escapeHtml(title)}</h2>
<p class="muted">${escapeHtml(description)}</p>
<form method="post" action="/config-section">
${csrfInput(session)}
<input type="hidden" name="section" value="${escapeHtml(section)}">
<textarea class="config-json" name="json">${escapeHtml(JSON.stringify(object || {}, null, 4))}</textarea>
<p><button class="success" type="submit">Save ${escapeHtml(title)}</button></p>
</form>
</section>`;
}

async function renderDashboard(client, session, notice = '', page = 'overview') {
    const config = getStoredConfig();
    const redactedConfig = redactSensitiveConfig(config);
    const settings = getCommandSettings(config);
    const grouped = groupCommands(client);
    const languageValues = language.loadLanguage();
    const editableLanguageValues = getEditableLanguageValues(languageValues);
    const lockedWatermark = language.getLockedWatermark();
    const logs = readDashboardLogs(120);
    const channels = getSendableChannels(client);
    const roles = getGuildRoles(client);
    const avatar = getBotAvatar(client);
    const dashboardGuild = getDashboardGuild(client);
    const activeGuildId = dashboardGuild?.id || getDashboardConfig().guildId || config.guildId;
    const scheduledMessages = await listScheduledMessages(activeGuildId, 25);
    const templates = await listEmbedTemplates(activeGuildId);
    const commandStats = await listCommandStats(activeGuildId, Date.now() - 30 * 24 * 60 * 60 * 1000);
    const allState = await readState();
    const moderationCases = await listModerationCases(activeGuildId || '', {});
    const modNotes = activeGuildId
        ? await Promise.all([...new Set(moderationCases.slice(0, 20).map(item => item.userId))].map(userId => listModNotes(activeGuildId, userId, 5))).then(results => results.flat())
        : [];
    const ticketRecords = await listTicketRecords(activeGuildId, 100);
    const ticketTranscripts = await listTicketTranscripts(activeGuildId, 50);
    const tempVoiceChannels = await listTempVoiceChannelsForGuild(activeGuildId);
    const voiceActivity = await listVoiceActivity(activeGuildId, 80);
    const configBackups = listConfigBackups();

    const moduleLinks = grouped.map(([category, commands]) => `
<a class="module-link" href="#module-${escapeHtml(slug(category))}">
<strong>${escapeHtml(humanize(category))}</strong>
<span class="muted">${commands.length} command${commands.length === 1 ? '' : 's'} ${settings.modules[category] === false ? 'disabled' : 'enabled'}</span>
</a>`).join('');

    const renderCommandSections = includeLanguageEditors => grouped.map(([category, commands]) => `
<section class="panel module-card" id="module-${escapeHtml(slug(category))}">
<div class="module-head">
<div><h2>${escapeHtml(humanize(category))}</h2><p class="muted">${commands.length} command${commands.length === 1 ? '' : 's'} in this module.</p></div>
<div class="split-actions">
<button class="secondary" type="button" data-collapse-target="#module-${escapeHtml(slug(category))}">Collapse</button>
<form method="post" action="/toggle-module">
${csrfInput(session)}
<input type="hidden" name="module" value="${escapeHtml(category)}">
<label><input type="checkbox" name="enabled" ${settings.modules[category] === false ? '' : 'checked'} onchange="this.form.submit()"> Module enabled</label>
</form>
</div>
</div>
<div class="module-body">
<div class="toolbar"><input data-command-search="#module-${escapeHtml(slug(category))}" placeholder="Search ${escapeHtml(humanize(category))} commands"></div>
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
${includeLanguageEditors ? getLanguageSectionsForCategory(category).map(section => renderLanguageEditor(section, languageValues[section], session)).join('') : ''}
</div>
</section>`).join('');

    const logsHtml = logs.length ? logs.map(log => `
<div class="log-entry"><span class="muted">${escapeHtml(log.at)}</span> ${escapeHtml(log.message)} ${log.type ? `<span class="muted">[${escapeHtml(log.type)}]</span>` : ''}</div>`).join('') : '<div class="muted">No dashboard logs yet.</div>';

    const channelOptions = channels.map(channel => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`).join('');
    const rolePills = roles.slice(0, 20).map(role => `<button class="pill" type="button" data-copy="${escapeHtml(role.id)}" data-copy-label="${escapeHtml(role.name)}">${escapeHtml(role.name)} ${escapeHtml(role.id)}</button>`).join('');
    const scheduledHtml = scheduledMessages.length
        ? scheduledMessages.map(item => `<div class="row"><span><strong>${escapeHtml(item.status)}</strong><br><span class="muted">${escapeHtml(new Date(Number(item.scheduledFor)).toLocaleString())} -> ${escapeHtml(item.channelId)}</span></span><span class="muted">${escapeHtml((item.content || item.embed?.title || 'Embed').slice(0, 80))}</span></div>`).join('')
        : '<p class="muted">No scheduled messages yet.</p>';
    const templateOptions = templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    const templatesHtml = templates.length
        ? templates.map(template => `<div class="row"><span><strong>${escapeHtml(template.name)}</strong><br><span class="muted">${escapeHtml(template.embed?.title || template.content || 'Embed template')}</span></span><form method="post" action="/embed-template/delete">${csrfInput(session)}<input type="hidden" name="id" value="${escapeHtml(template.id)}"><button class="danger" type="submit">Delete</button></form></div>`).join('')
        : '<p class="muted">No saved templates yet.</p>';
    const commandsHtml = renderCommandSections(true);
    const accessHtml = renderCommandSections(false);
    const topbar = `
${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
<div class="topbar" id="overview">
<div><h1>Dashboard</h1><p class="muted">Manage modules, responses, command access, and bot messages from one place.</p></div>
<div class="split-actions">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" style="width:46px;height:46px;border-radius:8px">` : ''}<a class="button secondary" href="/logout">Log out</a></div>
</div>`;
    const metricsSection = `
<section class="grid">
<div class="panel metric"><span>Modules</span><strong>${grouped.length}</strong></div>
<div class="panel metric"><span>Commands</span><strong>${[...client.commands.values()].length}</strong></div>
<div class="panel metric"><span>Sendable channels</span><strong>${channels.length}</strong></div>
<div class="panel metric"><span>Roles cached</span><strong>${roles.length}</strong></div>
</section>`;
    const moduleLinksSection = `
<section class="grid">
<div class="panel wide" id="modules">
<h2>Modules</h2>
<p class="muted">Click a module to jump into command toggles, access rules, and related response text.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${moduleLinks}</div>
</div>
<section class="panel side">
<h2>Quick Actions</h2>
<div class="pillrow">
<a class="button secondary" href="/sender">Open sender</a>
<a class="button secondary" href="/language">Edit language</a>
<a class="button secondary" href="/logs">View logs</a>
</div>
</section>
</section>`;
    const logsSection = `
<section class="panel side">
<h2>Logs</h2>
<div class="log">${logsHtml}</div>
<form method="post" action="/logs/clear" style="margin-top:12px">${csrfInput(session)}<button class="danger" type="submit">Clear logs</button></form>
</section>`;
    const senderSection = `
<section class="panel" id="sender">
<h2>Message Sender</h2>
<p class="muted">Send or schedule a message with embed fields, images, thumbnails, and reusable templates.</p>
<form method="post" action="/send-message" data-message-form>
${csrfInput(session)}
<div class="access-grid">
<label>Channel<select name="channelId" required>${channelOptions || '<option value="">No sendable channels cached</option>'}</select></label>
<label>Saved template<select name="templateId"><option value="">No template</option>${templateOptions}</select></label>
<label>Embed title<input name="embedTitle" maxlength="256" placeholder="Optional"></label>
<label>Embed color<input name="embedColor" placeholder="#5865f2"></label>
<label>Schedule for<input name="scheduleAt" type="datetime-local"></label>
</div>
<label>Message<textarea name="content" maxlength="2000" placeholder="Message content"></textarea></label>
<label>Embed description<textarea name="embedDescription" maxlength="4000" placeholder="Optional"></textarea></label>
<div class="access-grid">
<label>Embed URL<input name="embedUrl" placeholder="https://example.com"></label>
<label>Thumbnail URL<input name="embedThumbnail" placeholder="https://example.com/thumb.png"></label>
<label>Image URL<input name="embedImage" placeholder="https://example.com/image.png"></label>
<label>Footer<input name="embedFooter" maxlength="2048" placeholder="Optional footer"></label>
</div>
<label>Fields<textarea name="embedFields" placeholder="One per line: Field name | Field value"></textarea></label>
<div class="preview">
<p class="muted">Live preview</p>
<div data-preview-content class="preview-body"></div>
<div class="panel" style="box-shadow:none;margin:10px 0 0;border-left:4px solid var(--brand)">
<div data-preview-title class="preview-title"></div>
<div data-preview-body class="preview-body"></div>
</div>
</div>
<div class="access-grid">
<label>Template name<input name="templateName" maxlength="80" placeholder="Optional: save this as a template"></label>
<label><span class="muted">Template action</span><button class="secondary" name="saveTemplate" value="1" type="submit">Save template only</button></label>
</div>
<p><button class="success" type="submit">Send through bot</button></p>
</form>
<section class="panel" style="box-shadow:none;margin-top:16px">
<h3>Saved Templates</h3>
${templatesHtml}
</section>
<section class="panel" style="box-shadow:none;margin-top:16px">
<h3>Scheduled Messages</h3>
${scheduledHtml}
</section>
</section>`;
    const roleReferenceSection = rolePills ? `<section class="panel"><h2>Role Reference</h2><div class="pillrow">${rolePills}</div></section>` : '';
    const languageSection = `
<section class="panel">
<h2>All Language</h2>
<p class="muted">For broad edits, update response text here. The footer watermark is locked in code and will be preserved on save.</p>
<p class="pill">Locked watermark: ${escapeHtml(lockedWatermark.text)} (${escapeHtml(lockedWatermark.userId)})</p>
<form method="post" action="/language-json">
${csrfInput(session)}
<textarea class="config-json" name="language">${escapeHtml(JSON.stringify(editableLanguageValues, null, 4))}</textarea>
<p><button class="success" type="submit">Save language.json</button></p>
</form>
</section>`;
    const configSection = `
<section class="panel" id="config">
<h2>Config</h2>
<p class="muted">This edits config.json directly. Sensitive values are redacted and preserved if left unchanged. Create a backup before risky edits.</p>
<form method="post" action="/config/backup" style="margin-bottom:12px">${csrfInput(session)}<input type="hidden" name="label" value="before-config-edit"><button class="secondary" type="submit">Create backup</button></form>
<form method="post" action="/config-json">
${csrfInput(session)}
<textarea class="config-json" name="config">${escapeHtml(JSON.stringify(redactedConfig, null, 4))}</textarea>
<p><button type="submit">Save config</button></p>
</form>
</section>`;
    const languageEditorsSection = [...new Set(Object.keys(editableLanguageValues))]
        .map(section => renderLanguageEditor(section, editableLanguageValues[section], session))
        .join('');
    const commandSuccesses = commandStats.filter(item => item.ok).length;
    const commandFailures = commandStats.filter(item => !item.ok).length;
    const perDayRows = summarizeCounts(commandStats, item => new Date(item.createdAt).toISOString().slice(0, 10), 14);
    const analyticsSection = `
<section class="grid">
<div class="panel metric"><span>Commands 30d</span><strong>${commandStats.length}</strong></div>
<div class="panel metric"><span>Successful</span><strong>${commandSuccesses}</strong></div>
<div class="panel metric"><span>Failed</span><strong>${commandFailures}</strong></div>
<div class="panel metric"><span>Unique users</span><strong>${new Set(commandStats.map(item => item.userId)).size}</strong></div>
</section>
<section class="grid">
<div class="panel wide"><h2>Most Used Commands</h2>${renderCountRows(summarizeCounts(commandStats, item => `/${item.command}`))}</div>
<div class="panel side"><h2>Top Users</h2>${renderCountRows(summarizeCounts(commandStats, item => item.userTag || item.userId))}</div>
<div class="panel wide"><h2>Per-Day Usage</h2>${renderCountRows(perDayRows, 'No command usage in the last 30 days.')}</div>
<div class="panel side"><h2>Failed Commands</h2>${renderCountRows(summarizeCounts(commandStats.filter(item => !item.ok), item => `/${item.command}`), 'No failed commands recorded.')}</div>
</section>`;
    const auditItems = [
        ...logs.map(log => ({ at: Date.parse(log.at) || 0, type: log.type || 'dashboard', text: log.message })),
        ...moderationCases.slice(0, 200).map(item => ({ at: item.createdAt, type: 'moderation', text: `#${item.id} ${item.type} ${item.userTag || item.userId}: ${item.reason}` })),
        ...allState.history.filter(item => item.guildId === activeGuildId).slice(0, 200).map(item => ({ at: item.createdAt, type: item.type, text: `${item.userTag || item.userId}: ${item.summary}` })),
        ...ticketRecords.map(item => ({ at: item.updatedAt, type: 'ticket', text: `${item.status} <#${item.channelId}> ${item.priority}` })),
    ].sort((a, b) => b.at - a.at).slice(0, 250);
    const auditSection = `
<section class="panel">
<h2>Audit Timeline</h2>
<div class="toolbar"><input data-audit-filter placeholder="Filter moderation, tickets, honeypot, config, dashboard"></div>
<div class="log" data-audit-list>${auditItems.length ? auditItems.map(item => `<div class="log-entry" data-audit-type="${escapeHtml(item.type)}"><span class="muted">${escapeHtml(new Date(item.at || Date.now()).toLocaleString())}</span> [${escapeHtml(item.type)}] ${escapeHtml(item.text)}</div>`).join('') : '<div class="muted">No audit entries yet.</div>'}</div>
</section>`;
    const healthSection = `
<section class="grid">
<div class="panel metric"><span>Discord</span><strong>${client.isReady?.() ? 'Ready' : 'Offline'}</strong></div>
<div class="panel metric"><span>Ping</span><strong>${Math.round(client.ws?.ping || 0)}ms</strong></div>
<div class="panel metric"><span>Guilds</span><strong>${client.guilds?.cache?.size || 0}</strong></div>
<div class="panel metric"><span>Uptime</span><strong>${Math.floor(process.uptime() / 60)}m</strong></div>
</section>
<section class="panel"><h2>Schedulers</h2>
${['punishmentScheduler', 'memberCounterScheduler', 'mediaAnnouncementScheduler', 'levelingScheduler', 'scheduledMessageScheduler'].map(key => `<div class="row"><span>${escapeHtml(humanize(key))}</span><strong>${client[key] ? 'Running' : 'Stopped'}</strong></div>`).join('')}
</section>`;
    const moderationSection = `
${renderConfigSectionEditor('autoMod', 'Auto-Mod Rules', 'Configure invite links, mass mentions, caps/spam, suspicious domains, exemptions, and escalation ladder.', session, config.autoMod || {
    enabled: false,
    deleteMatches: true,
    rules: { inviteLinks: true, massMentions: true, caps: true, spam: true, suspiciousDomains: true },
    escalation: [{ after: 3, action: 'mute', durationMs: 600000 }],
})}
${renderConfigSectionEditor('moderation', 'Moderation Settings', 'Configure mute role and appeal URL for moderation DMs.', session, config.moderation || {})}
<section class="grid"><div class="panel wide"><h2>Recent Cases</h2>${moderationCases.slice(0, 20).map(item => `<div class="row"><span>#${escapeHtml(item.id)} ${escapeHtml(item.type)} ${escapeHtml(item.userTag || item.userId)}<br><span class="muted">${escapeHtml(item.reason)}</span></span><span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span></div>`).join('') || '<p class="muted">No cases yet.</p>'}</div><div class="panel side"><h2>Recent Notes</h2>${modNotes.slice(0, 10).map(item => `<div class="row"><span>${escapeHtml(item.userTag || item.userId)}<br><span class="muted">${escapeHtml(item.note)}</span></span></div>`).join('') || '<p class="muted">No notes yet.</p>'}</div></section>`;
    const ticketsSection = `
${renderConfigSectionEditor('tickets', 'Ticket Settings', 'Configure ticket panel channel, category, support role, auto-close days, and transcript behavior.', session, config.tickets || {})}
<section class="panel"><h2>Tickets</h2>${ticketRecords.length ? ticketRecords.map(item => `<div class="row"><span><strong><#${escapeHtml(item.channelId)}></strong><br><span class="muted">${escapeHtml(item.status)} - ${escapeHtml(item.priority)} - ${escapeHtml(item.tags?.join(', ') || 'no tags')}</span></span><span>${item.claimedById ? `Claimed by ${escapeHtml(item.claimedByTag || item.claimedById)}` : 'Unclaimed'}</span></div>`).join('') : '<p class="muted">No ticket records yet.</p>'}</section>
<section class="panel"><h2>Transcripts</h2>${ticketTranscripts.length ? ticketTranscripts.map(item => `<div class="row"><span><strong>${escapeHtml(item.ticketName || item.channelName)}</strong><br><span class="muted">${escapeHtml(new Date(item.createdAt).toLocaleString())} - ${escapeHtml(item.messageCount)} messages</span></span><a class="button secondary" href="/transcripts/${encodeURIComponent(item.id)}">Open</a></div>`).join('') : '<p class="muted">No transcripts have been generated yet.</p>'}</section>`;
    const communitySection = `
${renderConfigSectionEditor('WelcomeEmbed', 'Welcome / Leave Editor', 'Configure welcome copy and media. Leave messages can be added as leaveEmbed in config.json.', session, config.WelcomeEmbed || {})}
${renderConfigSectionEditor('reactionRoles', 'Reaction Roles', 'Configure reaction-role panels. Use messageId, emoji, and roleId entries for each panel.', session, config.reactionRoles || { enabled: false, panels: [] })}
${renderConfigSectionEditor('rulesAgreement', 'Rules Agreement Panel', 'Configure a rules acknowledgement panel and verified role.', session, config.rulesAgreement || { enabled: false, channelId: '', roleId: '' })}
${renderConfigSectionEditor('birthdays', 'Birthday Reminders', 'Configure birthday reminder channel and timezone.', session, config.birthdays || { enabled: false, channelId: '', timezone: 'Europe/London' })}
${renderConfigSectionEditor('starboard', 'Starboard', 'Configure highlight/starboard emoji, threshold, and destination channel.', session, config.starboard || { enabled: false, channelId: '', emoji: '⭐', threshold: 3 })}
${renderConfigSectionEditor('pollTemplates', 'Poll Templates', 'Saved poll presets for staff workflows.', session, config.pollTemplates || [])}`;
    const levelingSection = `
${renderConfigSectionEditor('leveling', 'Leveling Rewards and Multipliers', 'Configure reward roles, ignored channels/roles, role/channel multipliers, and reset policy.', session, config.leveling || {})}`;
    const voiceSection = `
${renderConfigSectionEditor('joinToCreate', 'Temporary Voice Controls', 'Configure join-to-create, naming, limits, categories, and presets.', session, config.joinToCreate || {})}
<section class="grid"><div class="panel wide"><h2>Active Temporary Channels</h2>${tempVoiceChannels.map(item => `<div class="row"><span><#${escapeHtml(item.channelId)}> owner <@${escapeHtml(item.ownerId)}></span><span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span></div>`).join('') || '<p class="muted">No active temporary voice channels.</p>'}</div><div class="panel side"><h2>Voice Activity</h2>${voiceActivity.slice(0, 20).map(item => `<div class="row"><span>${escapeHtml(item.userTag)} ${escapeHtml(item.type)}<br><span class="muted">${escapeHtml(item.oldChannelId || '-')} -> ${escapeHtml(item.newChannelId || '-')}</span></span></div>`).join('') || '<p class="muted">No voice activity yet.</p>'}</div></section>`;
    const mediaSection = `
${renderConfigSectionEditor('youtube', 'YouTube Targets', 'Manage channels to announce and their Discord destination channels.', session, config.youtube || {})}
${renderConfigSectionEditor('twitch', 'Twitch Targets', 'Manage Twitch channels, auth status, retry/error settings, and announcement templates.', session, config.twitch || {})}
${renderConfigSectionEditor('socialAnnouncements', 'Multi-Platform Targets', 'Configure TikTok, Instagram, Bluesky, and custom announcement templates. Integrations require provider APIs or feed endpoints.', session, config.socialAnnouncements || { tiktok: [], instagram: [], bluesky: [] })}`;
    const backupsSection = `
<section class="panel"><h2>Config Backups</h2><form method="post" action="/config/backup">${csrfInput(session)}<label>Label<input name="label" placeholder="before-risky-edit"></label><p><button class="success" type="submit">Create backup</button></p></form></section>
<section class="panel"><h2>Restore</h2>${configBackups.length ? configBackups.map(item => `<div class="row"><span>${escapeHtml(item.file)}<br><span class="muted">${escapeHtml(new Date(item.createdAt).toLocaleString())}</span></span><form method="post" action="/config/restore">${csrfInput(session)}<input type="hidden" name="file" value="${escapeHtml(item.file)}"><button class="danger" type="submit">Restore</button></form></div>`).join('') : '<p class="muted">No backups yet.</p>'}</section>`;
    const musicSection = `
${renderConfigSectionEditor('music', 'Music Settings', 'Configure music feature limits, allowed roles/channels, and provider notes. Spotify playback resolves track metadata to a streamable source.', session, config.music || { enabled: true, maxQueueLength: 50, allowFileUploads: true })}
<section class="panel"><h2>Playback</h2><p class="muted">Use /music play, /music file, /music queue, /music skip, and /music stop in Discord.</p></section>`;
    const pageBodies = {
        overview: `${topbar}${metricsSection}${moduleLinksSection}<section class="grid"><div class="panel wide"><h2>Recent Status</h2><p class="muted">Use the sidebar to manage commands, language, sending, config, and logs without scrolling through one large page.</p></div>${logsSection}</section>`,
        audit: `${topbar}${auditSection}`,
        analytics: `${topbar}${analyticsSection}`,
        health: `${topbar}${healthSection}`,
        modules: `${topbar}${moduleLinksSection}<section>${commandsHtml}</section>`,
        commands: `${topbar}${roleReferenceSection}<section>${accessHtml}</section>`,
        moderation: `${topbar}${moderationSection}`,
        tickets: `${topbar}${ticketsSection}`,
        community: `${topbar}${communitySection}`,
        leveling: `${topbar}${levelingSection}`,
        voice: `${topbar}${voiceSection}`,
        media: `${topbar}${mediaSection}`,
        music: `${topbar}${musicSection}`,
        language: `${topbar}${languageSection}<section>${languageEditorsSection}</section>`,
        sender: `${topbar}${senderSection}${roleReferenceSection}`,
        config: `${topbar}${configSection}`,
        backups: `${topbar}${backupsSection}`,
        logs: `${topbar}<section class="grid"><div class="panel full"><h2>Dashboard Logs</h2><div class="log">${logsHtml}</div><form method="post" action="/logs/clear" style="margin-top:12px">${csrfInput(session)}<button class="danger" type="submit">Clear logs</button></form></div></section>`,
    };

    return renderLayout('Bot Dashboard', pageBodies[page] || pageBodies.overview, session.user, client, page);
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

            const session = {
                user,
                createdAt: Date.now(),
                expiresAt: Date.now() + sessionMaxAgeMs,
                csrfToken: crypto.randomBytes(32).toString('hex'),
            };
            const sessionToken = createSessionToken(session);
            appendDashboardLog('Dashboard login', { userId: user.id });
            const secureCookie = currentSettings.publicUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
            res.setHeader('Set-Cookie', `dashboard_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionMaxAgeMs / 1000)}${secureCookie ? '; Secure' : ''}`);
            return res.redirect('/');
        } catch (error) {
            console.error('Dashboard OAuth failed:', error);
            return res.status(500).send('Discord OAuth failed. Check the dashboard OAuth settings.');
        }
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', 'dashboard_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        res.redirect('/login');
    });

    const renderPage = page => async (req, res) => res.send(await renderDashboard(client, req.dashboardSession, req.query.message || '', page));

    app.get('/', requireAuth, renderPage('overview'));
    app.get('/audit', requireAuth, renderPage('audit'));
    app.get('/analytics', requireAuth, renderPage('analytics'));
    app.get('/health-page', requireAuth, renderPage('health'));
    app.get('/modules', requireAuth, renderPage('modules'));
    app.get('/commands', requireAuth, renderPage('commands'));
    app.get('/moderation', requireAuth, renderPage('moderation'));
    app.get('/tickets', requireAuth, renderPage('tickets'));
    app.get('/transcripts/:id', requireAuth, async (req, res) => {
        const transcript = await getTicketTranscript(req.params.id);
        if (!transcript) {
            return res.status(404).send(renderLayout('Transcript not found', '<section class="panel"><h2>Transcript not found</h2><p>That transcript does not exist.</p></section>', req.dashboardSession.user, client, 'tickets'));
        }

        if (!await canViewTranscript(client, req.dashboardSession, transcript)) {
            return res.status(403).send(renderLayout('Transcript unavailable', '<section class="panel"><h2>Transcript unavailable</h2><p>You are not allowed to view this transcript.</p></section>', req.dashboardSession.user, client, 'tickets'));
        }

        return res.type('html').send(transcript.html);
    });
    app.get('/community', requireAuth, renderPage('community'));
    app.get('/leveling', requireAuth, renderPage('leveling'));
    app.get('/voice', requireAuth, renderPage('voice'));
    app.get('/media', requireAuth, renderPage('media'));
    app.get('/music', requireAuth, renderPage('music'));
    app.get('/language', requireAuth, renderPage('language'));
    app.get('/sender', requireAuth, renderPage('sender'));
    app.get('/config', requireAuth, renderPage('config'));
    app.get('/backups', requireAuth, renderPage('backups'));
    app.get('/logs', requireAuth, renderPage('logs'));

    app.post('/toggle-module', requireAuth, requireCsrf, (req, res) => {
        const enabled = req.body.enabled === 'on';
        updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.modules = config.commandSettings.modules || {};
            config.commandSettings.modules[req.body.module] = enabled;
            return config;
        });
        appendDashboardLog('Module toggle updated', { module: req.body.module, enabled, userId: req.dashboardSession.user.id });
        res.redirect(`/modules#module-${slug(req.body.module)}`);
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
        res.redirect('/commands');
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
        res.redirect('/commands');
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
            res.redirect('/language');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(error.message)}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/language-json', requireAuth, requireCsrf, (req, res) => {
        try {
            const parsed = JSON.parse(req.body.language);
            language.saveLanguage(parsed);
            appendDashboardLog('language.json saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/language?message=language.json%20saved');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(error.message)}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/send-message', requireAuth, requireCsrf, async (req, res) => {
        try {
            const channel = await client.channels.fetch(req.body.channelId).catch(() => null);
            if (!channel?.send && req.body.saveTemplate !== '1') {
                return res.status(400).send(renderLayout('Message not sent', '<section class="panel"><h2>Message not sent</h2><p>I could not find a sendable channel.</p></section>', req.dashboardSession.user, client));
            }

            const activeGuildId = getDashboardGuild(client)?.id || getDashboardConfig().guildId || getStoredConfig().guildId;
            const selectedTemplate = req.body.templateId
                ? (await listEmbedTemplates(activeGuildId)).find(item => item.id === req.body.templateId)
                : null;
            const payload = selectedTemplate && !req.body.content && !req.body.embedTitle && !req.body.embedDescription
                ? {
                    content: selectedTemplate.content,
                    embed: selectedTemplate.embed,
                    embeds: selectedTemplate.embed ? [buildEmbedFromTemplate(selectedTemplate.embed)] : undefined,
                }
                : buildDashboardMessagePayload(req.body);
            if (!payload.content && !payload.embeds) {
                return res.status(400).send(renderLayout('Message not sent', '<section class="panel"><h2>Message not sent</h2><p>Add message content or embed text before sending.</p></section>', req.dashboardSession.user, client));
            }

            if (req.body.saveTemplate === '1') {
                const templateName = String(req.body.templateName || '').trim();
                if (!templateName) {
                    return res.status(400).send(renderLayout('Template not saved', '<section class="panel"><h2>Template not saved</h2><p>Add a template name before saving.</p></section>', req.dashboardSession.user, client));
                }

                await upsertEmbedTemplate({
                    guildId: activeGuildId,
                    name: templateName,
                    content: payload.content || '',
                    embed: payload.embed || null,
                    updatedBy: req.dashboardSession.user.id,
                });
                appendDashboardLog('Embed template saved', { name: templateName, userId: req.dashboardSession.user.id });
                return res.redirect('/sender?message=Template%20saved');
            }

            const scheduleAt = String(req.body.scheduleAt || '').trim();
            if (scheduleAt) {
                const scheduledFor = Date.parse(scheduleAt);
                if (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now()) {
                    return res.status(400).send(renderLayout('Message not scheduled', '<section class="panel"><h2>Message not scheduled</h2><p>Choose a future date and time.</p></section>', req.dashboardSession.user, client));
                }

                await createScheduledMessage({
                    guildId: channel.guildId || getDashboardConfig().guildId,
                    channelId: channel.id,
                    content: payload.content || '',
                    embed: payload.embed || null,
                    createdBy: req.dashboardSession.user.id,
                    scheduledFor,
                });
                appendDashboardLog('Dashboard message scheduled', { channelId: channel.id, userId: req.dashboardSession.user.id, scheduledFor });
                return res.redirect('/sender?message=Message%20scheduled');
            }

            const sendPayload = {};
            if (payload.content) sendPayload.content = payload.content;
            if (payload.embeds) sendPayload.embeds = payload.embeds;
            await channel.send(sendPayload);
            appendDashboardLog('Dashboard message sent', { channelId: channel.id, userId: req.dashboardSession.user.id });
            return res.redirect('/sender?message=Message%20sent');
        } catch (error) {
            console.error('Dashboard message send failed:', error);
            res.status(500).send(renderLayout('Message failed', '<section class="panel"><h2>Message failed</h2><p>Discord rejected the message. Check the bot permissions and message content.</p></section>', req.dashboardSession.user, client));
        }
    });

    app.post('/embed-template/delete', requireAuth, requireCsrf, async (req, res) => {
        const activeGuildId = getDashboardGuild(client)?.id || getDashboardConfig().guildId || getStoredConfig().guildId;
        await deleteEmbedTemplate(activeGuildId, req.body.id);
        appendDashboardLog('Embed template deleted', { id: req.body.id, userId: req.dashboardSession.user.id });
        res.redirect('/sender?message=Template%20deleted');
    });

    app.post('/config-section', requireAuth, requireCsrf, (req, res) => {
        try {
            const section = String(req.body.section || '').trim();
            if (!section || ['token', 'clientId', 'guildId', 'dashboard', 'database'].includes(section)) {
                return res.status(400).send(renderLayout('Invalid section', '<section class="panel"><h2>Invalid config section</h2><p>Use the full config editor for this section.</p></section>', req.dashboardSession.user, client));
            }

            const parsed = JSON.parse(req.body.json || '{}');
            updateConfig(config => {
                config[section] = parsed;
                return config;
            });
            appendDashboardLog('Config section saved', { section, userId: req.dashboardSession.user.id });
            const sectionPages = {
                autoMod: 'moderation',
                moderation: 'moderation',
                tickets: 'tickets',
                WelcomeEmbed: 'community',
                reactionRoles: 'community',
                rulesAgreement: 'community',
                birthdays: 'community',
                starboard: 'community',
                pollTemplates: 'community',
                leveling: 'leveling',
                joinToCreate: 'voice',
                youtube: 'media',
                twitch: 'media',
                socialAnnouncements: 'media',
                music: 'music',
            };
            res.redirect(`/${sectionPages[section] || 'config'}?message=Saved`);
        } catch (error) {
            res.status(400).send(renderLayout('Invalid JSON', `<section class="panel"><h2>Invalid JSON</h2><p>${escapeHtml(error.message)}</p></section>`, req.dashboardSession.user, client));
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
            res.redirect('/config');
        } catch {
            res.status(400).send(renderLayout('Invalid JSON', '<section class="panel"><h2>Invalid JSON</h2><p>The config was not saved. Use the browser back button and fix the JSON.</p></section>', req.dashboardSession.user, client));
        }
    });

    app.post('/config/backup', requireAuth, requireCsrf, (req, res) => {
        const file = createConfigBackup(req.body.label);
        appendDashboardLog('Config backup created', { file, userId: req.dashboardSession.user.id });
        res.redirect('/backups?message=Backup%20created');
    });

    app.post('/config/restore', requireAuth, requireCsrf, (req, res) => {
        try {
            createConfigBackup('before-restore');
            restoreConfigBackup(req.body.file);
            appendDashboardLog('Config backup restored', { file: req.body.file, userId: req.dashboardSession.user.id });
            res.redirect('/backups?message=Backup%20restored');
        } catch (error) {
            res.status(400).send(renderLayout('Restore failed', `<section class="panel"><h2>Restore failed</h2><p>${escapeHtml(error.message)}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/logs/clear', requireAuth, requireCsrf, (req, res) => {
        clearDashboardLogs();
        appendDashboardLog('Dashboard logs cleared', { userId: req.dashboardSession.user.id });
        res.redirect('/logs');
    });

    const server = app.listen(settings.port, settings.host, () => {
        console.log(`[DASHBOARD] Listening on ${settings.publicUrl}`);
        appendDashboardLog('Dashboard started', { url: settings.publicUrl });
    });

    return server;
}

module.exports = {
    createSessionToken,
    redactSensitiveConfig,
    restoreRedactedSecrets,
    startDashboard,
    verifySessionToken,
};
