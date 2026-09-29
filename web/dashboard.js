const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, getStoredConfig, saveConfig, updateConfig } = require('../utils/config');
const { validateConfig } = require('../utils/configValidation');
const { appendDashboardLog, clearDashboardLogs, readDashboardLogs } = require('../utils/dashboardLogs');
const { getCommandSettings } = require('../utils/features');
const language = require('../utils/language');
const { getQueueSummary } = require('../utils/music');
const { getCommandAccess, normalizeIdList } = require('../utils/permissions');
const { buildHealthReport, buildPublicHealthReport } = require('../services/diagnostics');
const {
    assertSafeConfigObject,
    redactSensitiveConfig,
    restoreProtectedConfig,
    safeErrorMessage,
} = require('../utils/redaction');
const { applyDashboardSettings, parseDashboardSettings } = require('./services/dashboardConfig');
const {
    buildRestoredConfig,
    createConfigBackup,
    listConfigBackups,
    restoreConfigBackup,
} = require('./services/configBackups');
const { getGuildSettings, listConfigAudit, updateGuildSettings } = require('../utils/guildConfig');
const {
    renderSegmented,
    renderSelect,
    renderSettingsForm,
    renderTextInput,
    renderTextarea,
    renderToggle,
} = require('./views/components/forms');
const {
    renderLoggingDashboard,
    renderModuleDashboard,
    renderOverviewDashboard,
    renderTicketDashboard,
    renderVoiceDashboard,
} = require('./views/components/dashboardPanels');
const { escapeHtml } = require('./views/components/html');
const { renderPageHeader } = require('./views/components/ui');
const { renderLayout } = require('./views/layout');
const {
    createScheduledMessage,
    deleteEmbedTemplate,
    listCommandStats,
    listEmbedTemplates,
    listGuildHistory,
    listModerationCases,
    listModNotes,
    listScheduledMessages,
    listTempVoiceChannelsForGuild,
    listTicketRecords,
    listTicketTranscripts,
    listVoiceActivity,
    getTicketTranscript,
    upsertEmbedTemplate,
} = require('../utils/store');

const states = new Map();
const sessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const maxOAuthStates = 500;
const dashboardPermission = PermissionFlagsBits.Administrator;

function decodeCookieValue(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const index = part.indexOf('=');
            if (index === -1) return [part, ''];
            return [part.slice(0, index), decodeCookieValue(part.slice(index + 1))];
        }));
}

function cleanupExpiringMaps() {
    const now = Date.now();
    for (const [state, expiresAt] of states.entries()) {
        if (expiresAt <= now) states.delete(state);
    }
    while (states.size > maxOAuthStates) {
        const oldest = states.keys().next().value;
        if (!oldest) break;
        states.delete(oldest);
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
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
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

function restoreRedactedSecrets(submitted, current) {
    return restoreProtectedConfig(submitted, current);
}

function csrfInput(session) {
    return `<input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">`;
}

function getConfiguredDashboardAdminUserIds(config = getConfig()) {
    return new Set(normalizeIdList(config.devs));
}

async function userCanAdminDashboard(client, userId, guild) {
    if (!userId || !guild?.id) return false;
    const config = getConfig();
    if (getConfiguredDashboardAdminUserIds(config).has(userId)) return true;
    if (guild.ownerId === userId) return true;

    const member = await guild.members?.fetch?.(userId).catch(() => null);
    if (!member) return false;
    if (member.permissions?.has?.(dashboardPermission)) return true;
    return false;
}

function requireDashboardAdmin(client) {
    return async (req, res, next) => {
        const guild = getDashboardGuild(client);
        const userId = req.dashboardSession?.user?.id;
        if (!guild || !await userCanAdminDashboard(client, userId, guild)) {
            appendDashboardLog('Dashboard authorization denied', { guildId: guild?.id, userId });
            return res.status(403).send('You are not allowed to manage this dashboard.');
        }

        req.dashboardGuild = guild;
        return next();
    };
}

function wantsJson(req) {
    return req.get('x-dashboard-async') === '1' || req.accepts(['json', 'html']) === 'json';
}

function sendSettingsError(req, res, client, error) {
    const message = safeErrorMessage(error, 'Settings were not saved.');
    if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message });
    }

    return res.status(400).send(renderLayout('Settings not saved', `<section class="panel"><h2>Settings not saved</h2><p>${escapeHtml(message)}</p><p>Use the browser back button to keep editing.</p></section>`, req.dashboardSession.user, client));
}

function dashboardSettingsPage(section) {
    return {
        modules: '/modules',
        welcome: '/community',
        logging: '/config',
        tickets: '/tickets',
        joinToCreate: '/voice',
        leveling: '/leveling',
        moderation: '/moderation',
        music: '/music',
    }[section] || '/config';
}

function makeDiscordOauthUrl(settings) {
    cleanupExpiringMaps();
    const state = crypto.randomBytes(24).toString('hex');
    states.set(state, Date.now() + 10 * 60 * 1000);
    cleanupExpiringMaps();

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

async function canManageDashboard(discordUser, guilds, settings, client) {
    const config = getConfig();
    if (getConfiguredDashboardAdminUserIds(config).has(discordUser.id)) return true;

    const guild = guilds.find(item => item.id === settings.guildId);
    if (!guild) return false;
    if (guild.owner === true) return true;

    const permissions = BigInt(guild.permissions || 0);
    if ((permissions & dashboardPermission) === dashboardPermission) return true;

    const activeGuild = client ? getDashboardGuild(client) : null;
    return activeGuild?.id === settings.guildId
        ? userCanAdminDashboard(client, discordUser.id, activeGuild)
        : false;
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

    const guildConfig = await getGuildSettings(transcript.guildId);
    const supportRoleId = guildConfig.tickets?.supportRoleId || config.tickets?.supportRoleId || config.ticketRole;
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

function getGuildChannels(client) {
    const guild = getDashboardGuild(client);
    if (!guild?.channels?.cache) return [];

    return [...guild.channels.cache.values()]
        .filter(channel => channel?.id && channel?.name)
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || a.name.localeCompare(b.name));
}

function channelLabel(channel) {
    if (channel.type === ChannelType.GuildCategory) return `[category] ${channel.name}`;
    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) return `[voice] ${channel.name}`;
    if (channel.type === ChannelType.GuildAnnouncement) return `# ${channel.name} (announcement)`;
    return `# ${channel.name}`;
}

function channelOptions(channels, types) {
    const allowed = new Set(types);
    return channels
        .filter(channel => allowed.has(channel.type))
        .map(channel => ({ value: channel.id, label: channelLabel(channel) }));
}

function roleOptions(roles) {
    return roles.map(role => ({ value: role.id, label: `@${role.name}` }));
}

function resolveUserLabel(client, guild, userId) {
    if (!userId) return 'System';
    const member = guild?.members?.cache?.get?.(userId);
    if (member) return member.displayName || member.user?.tag || userId;
    const user = client.users?.cache?.get?.(userId);
    return user?.tag || user?.username || userId;
}

function getGuildRoles(client) {
    const guild = getDashboardGuild(client);
    if (!guild?.roles?.cache) return [];

    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
}

function channelBelongsToGuild(channel, guild) {
    return Boolean(channel && guild?.id && (channel.guildId === guild.id || channel.guild?.id === guild.id));
}

function botCanSend(channel, guild) {
    if (!channel?.send) return false;
    const botMember = guild?.members?.me;
    if (!channel.permissionsFor || !botMember) return true;
    const permissions = channel.permissionsFor(botMember);
    return permissions?.has?.(PermissionFlagsBits.ViewChannel) !== false
        && permissions?.has?.(PermissionFlagsBits.SendMessages) !== false;
}

async function resolveDashboardChannel(guild, channelId, {
    label = 'Channel',
    types = [],
    requireSendable = false,
} = {}) {
    const id = String(channelId || '').trim();
    if (!id) throw new Error(`${label} is required.`);

    const channel = guild?.channels?.cache?.get?.(id)
        || await guild?.channels?.fetch?.(id).catch(() => null);
    if (!channel || !channelBelongsToGuild(channel, guild)) {
        throw new Error(`${label} is not part of this server.`);
    }
    if (types.length && !types.includes(channel.type)) {
        throw new Error(`${label} has the wrong channel type.`);
    }
    if (requireSendable && !botCanSend(channel, guild)) {
        throw new Error(`${label} is not sendable by the bot.`);
    }

    return channel;
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
    return `<details class="panel advanced-json">
<summary><span><strong>Advanced JSON: ${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span></summary>
<form method="post" action="/config-section">
${csrfInput(session)}
<input type="hidden" name="section" value="${escapeHtml(section)}">
<textarea class="config-json" name="json">${escapeHtml(JSON.stringify(object || {}, null, 4))}</textarea>
<p><button class="success" type="submit">Save ${escapeHtml(title)}</button></p>
</form>
</details>`;
}

const editableConfigSectionPages = Object.freeze({
    autoMod: 'moderation',
    reactionRoles: 'community',
    rulesAgreement: 'community',
    birthdays: 'community',
    starboard: 'community',
    pollTemplates: 'community',
    youtube: 'media',
    twitch: 'media',
    socialAnnouncements: 'media',
});

const editableConfigSectionTypes = Object.freeze({
    autoMod: 'object',
    reactionRoles: 'object',
    rulesAgreement: 'object',
    birthdays: 'object',
    starboard: 'object',
    pollTemplates: 'array',
    youtube: 'object',
    twitch: 'object',
    socialAnnouncements: 'object',
});

function validateConfigSectionEdit(section, value, currentConfig) {
    const expectedType = editableConfigSectionTypes[section];
    if (!expectedType) throw new Error('Unsupported config section.');

    if (expectedType === 'array' && !Array.isArray(value)) {
        throw new Error(`${section} must be a JSON array.`);
    }
    if (expectedType === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(`${section} must be a JSON object.`);
    }

    const candidate = { ...currentConfig, [section]: value };
    const errors = validateConfig(candidate);
    if (errors.length) throw new Error(errors.join('\n'));
}

function renderModuleSettingsForm(grouped, settings, session) {
    const rows = grouped.map(([category, commands]) => renderToggle(
        `module:${category}`,
        humanize(category),
        settings.modules[category] !== false,
        `${commands.length} command${commands.length === 1 ? '' : 's'}`,
    )).join('');

    return renderSettingsForm({
        title: 'Module Settings',
        description: 'Enable or disable command modules without editing commandSettings JSON.',
        section: 'modules',
        session,
        body: `
<input type="hidden" name="moduleKeys" value="${escapeHtml(grouped.map(([category]) => category).join(','))}">
<div class="settings-grid">${rows}</div>`,
    });
}

function renderWelcomeSettingsForm(config, channels, session) {
    const welcome = config.WelcomeEmbed || {};
    const welcomeState = config.welcome || {
        enabled: Boolean(config.welcomeID),
        channelId: config.welcomeID || '',
    };
    return renderSettingsForm({
        title: 'Welcome',
        description: 'Server-specific welcome settings for the selected guild.',
        section: 'welcome',
        session,
        body: `
<div class="settings-stack">
${renderToggle('welcomeEnabled', 'Welcome messages', welcomeState.enabled === true, 'Send a welcome embed when a member joins.')}
<div class="settings-grid">
${renderSelect('welcomeID', 'Welcome channel', channelOptions(channels, [ChannelType.GuildText, ChannelType.GuildAnnouncement]), welcomeState.channelId, { emptyLabel: 'Choose a channel' })}
${renderTextInput('welcomeTitle', 'Embed title', welcome.title || '', { maxLength: 256 })}
</div>
${renderTextarea('welcomeDescription', 'Message', welcome.description || '', { rows: 5, description: 'Supports placeholders already used by the welcome command, such as ${user}.' })}
${renderTextInput('welcomeFooter', 'Footer', welcome.footer || '', { maxLength: 2048 })}
</div>`,
    });
}

function renderLoggingSettingsForm(config, channels, session) {
    const logChannels = config.logChannels || {};
    const sendable = channelOptions(channels, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    const select = (name, label) => renderSelect(name, label, sendable, logChannels[name], { emptyLabel: 'Use default / disabled' });

    return renderSettingsForm({
        title: 'Logging',
        description: 'Server-specific logging map for the selected guild. Leave a category unset to use the default log channel where supported.',
        section: 'logging',
        session,
        body: `
<div class="settings-stack">
${renderToggle('showUserAvatars', 'Show user avatars', config.logging?.showUserAvatars !== false, 'Include user avatars in supported log embeds.')}
<div class="settings-grid">
${select('logChannel', 'Default logs')}
${select('moderation', 'Moderation')}
${select('ticket', 'Tickets')}
${select('suggestion', 'Suggestions')}
${select('messageDelete', 'Message deletes')}
${select('editMessage', 'Message edits')}
${select('threadCreate', 'Thread creates')}
${select('threadDelete', 'Thread deletes')}
${select('threadUpdate', 'Thread updates')}
${select('directMessage', 'Direct messages')}
</div>
</div>`,
    });
}

function renderTicketSettingsForm(config, channels, roles, session) {
    const tickets = config.tickets || {};
    return renderSettingsForm({
        title: 'Tickets',
        description: 'Server-specific ticket panel, category, and staff access for the selected guild.',
        section: 'tickets',
        session,
        body: `
<div class="settings-grid">
${renderSelect('ticketChannelId', 'Panel channel', channelOptions(channels, [ChannelType.GuildText, ChannelType.GuildAnnouncement]), tickets.channelId, { emptyLabel: 'Choose a channel' })}
${renderSelect('ticketCategoryId', 'Ticket category', channelOptions(channels, [ChannelType.GuildCategory]), tickets.categoryId, { emptyLabel: 'Choose a category' })}
${renderSelect('supportRoleId', 'Support role', roleOptions(roles), tickets.supportRoleId || config.ticketRole, { emptyLabel: 'Choose a role' })}
${renderTextInput('closeInactivityDays', 'Close inactivity days', tickets.closeInactivityDays ?? '', { type: 'number', description: '0 disables inactivity closing.' })}
</div>
<div class="settings-grid">
${renderToggle('allowTranscripts', 'Allow transcripts', tickets.allowTranscripts !== false, 'Staff can generate transcript records.')}
${renderToggle('allowUserAdding', 'Allow user adding', tickets.allowUserAdding !== false, 'Staff can add or remove ticket participants.')}
${renderToggle('allowClaiming', 'Allow claiming', tickets.allowClaiming !== false, 'Staff can claim tickets.')}
</div>`,
    });
}

function renderJoinToCreateSettingsForm(config, channels, session) {
    const voice = config.joinToCreate || {};
    return renderSettingsForm({
        title: 'Temporary Voice',
        description: 'Server-specific join-to-create settings using real voice channel and category selectors.',
        section: 'joinToCreate',
        session,
        body: `
<div class="settings-stack">
${renderToggle('enabled', 'Join-to-create', voice.enabled === true, 'Create temporary voice channels when users join the trigger channel.')}
<div class="settings-grid">
${renderSelect('triggerChannelId', 'Trigger channel', channelOptions(channels, [ChannelType.GuildVoice, ChannelType.GuildStageVoice]), voice.triggerChannelId, { emptyLabel: 'Choose a voice channel' })}
${renderSelect('categoryId', 'Temporary channel category', channelOptions(channels, [ChannelType.GuildCategory]), voice.categoryId, { emptyLabel: 'Choose a category' })}
${renderTextInput('nameFormat', 'Name format', voice.nameFormat || "{username}'s Channel", { description: 'Use {username}, {displayName}, {tag}, or {id}.' })}
${renderTextInput('userLimitMax', 'Maximum users', voice.userLimitMax || 25, { type: 'number' })}
${renderTextInput('emptyGraceSeconds', 'Empty grace period seconds', Math.round(Number(voice.emptyGraceMs || 10000) / 1000), { type: 'number' })}
</div>
</div>`,
    });
}

function renderLevelingSettingsForm(config, session) {
    const leveling = config.leveling || {};
    return renderSettingsForm({
        title: 'Leveling',
        description: 'Server-specific leveling mode and XP pacing with bounded controls.',
        section: 'leveling',
        session,
        body: `
<div class="settings-stack">
${renderToggle('enabled', 'Leveling', leveling.enabled === true, 'Award XP through text, voice, or both.')}
<label>Mode${renderSegmented('mode', [
        { value: 'text', label: 'Text' },
        { value: 'voice', label: 'Voice' },
        { value: 'both', label: 'Both' },
    ], leveling.mode || 'both')}</label>
<div class="settings-grid">
${renderTextInput('textXpPerMessage', 'Text XP per message', leveling.textXpPerMessage ?? 1, { type: 'number' })}
${renderTextInput('voiceXpPerMinute', 'Voice XP per minute', leveling.voiceXpPerMinute ?? 1, { type: 'number' })}
${renderTextInput('cooldownSeconds', 'Text XP cooldown seconds', leveling.cooldownSeconds ?? 60, { type: 'number' })}
</div>
</div>`,
    });
}

function renderModerationSettingsForm(config, roles, session) {
    const moderation = config.moderation || {};
    return renderSettingsForm({
        title: 'Moderation Settings',
        description: 'Configure mute role behavior and the appeal link used in moderation messages.',
        section: 'moderation',
        session,
        body: `<div class="settings-stack">
${renderSelect('muteRoleId', 'Mute role', roleOptions(roles), moderation.muteRoleId || '', { emptyLabel: 'Use mute role name' })}
${renderTextInput('muteRoleName', 'Mute role name', moderation.muteRoleName || 'Muted', { maxLength: 80 })}
${renderTextInput('appealUrl', 'Appeal URL', moderation.appealUrl || '', { type: 'url', placeholder: 'https://example.com/appeal' })}
</div>`,
    });
}

function renderMusicSettingsForm(config, session) {
    const music = config.music || {};
    return renderSettingsForm({
        title: 'Music Settings',
        description: 'Configure playback availability, queue limits, upload behavior, and voice connection retries.',
        section: 'music',
        session,
        body: `<div class="settings-stack">
${renderToggle('enabled', 'Music commands', music.enabled !== false, 'Allow music playback commands.')}
${renderToggle('allowFileUploads', 'File uploads', music.allowFileUploads !== false, 'Allow users to play uploaded audio files.')}
${renderToggle('voiceDebug', 'Voice diagnostics', music.voiceDebug === true, 'Include additional voice connection diagnostics.')}
<div class="settings-grid">
${renderTextInput('maxQueueLength', 'Maximum queue length', music.maxQueueLength ?? 50, { type: 'number', min: 1, max: 1000 })}
${renderTextInput('voiceReadyTimeoutMs', 'Voice ready timeout', music.voiceReadyTimeoutMs ?? 60000, { type: 'number', min: 5000, max: 300000, step: 1000 })}
${renderTextInput('voiceJoinRetries', 'Voice join retries', music.voiceJoinRetries ?? 1, { type: 'number', min: 0, max: 10 })}
${renderTextInput('voiceRetryDelayMs', 'Voice retry delay', music.voiceRetryDelayMs ?? 1000, { type: 'number', min: 0, max: 60000, step: 100 })}
</div>
${renderTextInput('ytDlpCookiesPath', 'YouTube cookies path', music.ytDlpCookiesPath || '', { placeholder: 'data/youtube-cookies.txt' })}
</div>`,
    });
}

async function renderDashboard(client, session, notice = '', page = 'overview') {
    const config = getStoredConfig();
    const redactedConfig = redactSensitiveConfig(config);
    const settings = getCommandSettings(config);
    const grouped = groupCommands(client);
    const languageValues = language.loadLanguage();
    const editableLanguageValues = getEditableLanguageValues(languageValues);
    const lockedWatermark = language.getLockedWatermark();
    const channels = getSendableChannels(client);
    const allChannels = getGuildChannels(client);
    const roles = getGuildRoles(client);
    const dashboardGuild = getDashboardGuild(client);
    const activeGuildId = dashboardGuild?.id || getDashboardConfig().guildId || config.guildId;
    const effectiveConfig = activeGuildId ? await getGuildSettings(activeGuildId) : config;
    const needsLogs = ['overview', 'logs', 'audit'].includes(page);
    const needsSender = page === 'sender';
    const needsCommandStats = ['overview', 'modules', 'analytics'].includes(page);
    const needsAudit = page === 'audit';
    const needsModeration = ['overview', 'moderation', 'audit'].includes(page);
    const needsTickets = ['overview', 'tickets', 'audit'].includes(page);
    const needsVoice = ['overview', 'voice'].includes(page);
    const needsBackups = page === 'backups';
    const logs = needsLogs ? readDashboardLogs(120) : [];
    const scheduledMessages = needsSender ? await listScheduledMessages(activeGuildId, 25) : [];
    const templates = needsSender ? await listEmbedTemplates(activeGuildId) : [];
    const commandStats = needsCommandStats ? await listCommandStats(activeGuildId, Date.now() - 30 * 24 * 60 * 60 * 1000) : [];
    const historyItems = needsAudit && activeGuildId ? await listGuildHistory(activeGuildId, 200) : [];
    const moderationCases = needsModeration ? await listModerationCases(activeGuildId || '', {}) : [];
    const modNotes = page === 'moderation' && activeGuildId
        ? await Promise.all([...new Set(moderationCases.slice(0, 20).map(item => item.userId))].map(userId => listModNotes(activeGuildId, userId, 5))).then(results => results.flat())
        : [];
    const ticketRecords = needsTickets ? await listTicketRecords(activeGuildId, 100) : [];
    const ticketTranscripts = page === 'tickets' ? await listTicketTranscripts(activeGuildId, 50) : [];
    const tempVoiceChannels = needsVoice ? await listTempVoiceChannelsForGuild(activeGuildId) : [];
    const voiceActivity = needsVoice ? await listVoiceActivity(activeGuildId, 80) : [];
    const musicSummary = page === 'overview' && activeGuildId ? getQueueSummary(activeGuildId) : {};
    const configBackups = needsBackups ? listConfigBackups() : [];
    const configAudit = needsAudit && activeGuildId ? await listConfigAudit(activeGuildId, { limit: 75 }) : [];
    const healthReport = ['overview', 'health'].includes(page) ? await buildHealthReport(client) : null;

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
    const moduleSettingsSection = renderModuleSettingsForm(grouped, settings, session);
    const welcomeSettingsSection = renderWelcomeSettingsForm(effectiveConfig, allChannels, session);
    const loggingSettingsSection = renderLoggingSettingsForm(effectiveConfig, allChannels, session);
    const ticketSettingsSection = renderTicketSettingsForm(effectiveConfig, allChannels, roles, session);
    const joinToCreateSettingsSection = renderJoinToCreateSettingsForm(effectiveConfig, allChannels, session);
    const levelingSettingsForm = renderLevelingSettingsForm(effectiveConfig, session);
    const moderationSettingsSection = renderModerationSettingsForm(config, roles, session);
    const musicSettingsSection = renderMusicSettingsForm(config, session);
    const topbar = renderPageHeader({
        eyebrow: dashboardGuild?.name || 'Dashboard',
        title: 'Dashboard',
        description: 'Manage modules, responses, command access, and bot messages from one place.',
        notice,
        actions: '<a class="button secondary" href="/logout">Log out</a>',
    });
    const overviewSection = renderOverviewDashboard({
        client,
        guild: dashboardGuild,
        grouped,
        ticketRecords,
        tempVoiceChannels,
        moderationCases,
        musicSummary,
        commandStats,
        logs,
        voiceActivity,
        health: healthReport,
    });
    const moduleLinksSection = `
${renderModuleDashboard(grouped, settings, commandStats)}
<section class="grid">
<section class="panel full">
<h2>Quick Actions</h2>
<div class="pillrow">
<a class="button secondary" href="/sender">Open sender</a>
<a class="button secondary" href="/language">Edit language</a>
<a class="button secondary" href="/logs">View logs</a>
</div>
</section>
</section>`;
    const loggingDashboardSection = renderLoggingDashboard(effectiveConfig, dashboardGuild);
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
${moduleSettingsSection}
${loggingSettingsSection}
${loggingDashboardSection}
<section class="panel" id="config">
<h2>Advanced Config JSON</h2>
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
        ...historyItems.map(item => ({ at: item.createdAt, type: item.type, text: `${item.userTag || item.userId}: ${item.summary}` })),
        ...ticketRecords.map(item => ({ at: item.updatedAt, type: 'ticket', text: `${item.status} <#${item.channelId}> ${item.priority}` })),
    ].sort((a, b) => b.at - a.at).slice(0, 250);
    const configAuditRows = configAudit.map(item => `<tr>
<td>${escapeHtml(new Date(item.createdAt || Date.now()).toLocaleString())}</td>
<td>${escapeHtml(resolveUserLabel(client, dashboardGuild, item.actorId))}<br><span class="muted">${escapeHtml(item.actorId || '')}</span></td>
<td>${escapeHtml(item.section)}</td>
<td>${escapeHtml(item.key)}</td>
<td>${escapeHtml(item.previousValue)}</td>
<td>${escapeHtml(item.newValue)}</td>
<td>${escapeHtml(item.source)}</td>
</tr>`).join('');
    const auditSection = `
<section class="panel">
<h2>Configuration Changes</h2>
<div class="table-wrap"><table class="dashboard-table"><thead><tr><th>Time</th><th>Admin</th><th>Section</th><th>Setting</th><th>Previous</th><th>New</th><th>Source</th></tr></thead><tbody>${configAuditRows || '<tr><td colspan="7">No configuration changes recorded yet.</td></tr>'}</tbody></table></div>
</section>
<section class="panel">
<h2>Audit Timeline</h2>
<div class="toolbar"><input data-audit-filter placeholder="Filter moderation, tickets, honeypot, config, dashboard"></div>
<div class="log" data-audit-list>${auditItems.length ? auditItems.map(item => `<div class="log-entry" data-audit-type="${escapeHtml(item.type)}"><span class="muted">${escapeHtml(new Date(item.at || Date.now()).toLocaleString())}</span> [${escapeHtml(item.type)}] ${escapeHtml(item.text)}</div>`).join('') : '<div class="muted">No audit entries yet.</div>'}</div>
</section>`;
    const databaseState = healthReport?.databaseReadable
        ? (healthReport.databaseWritable === false ? 'Read-only' : 'Reachable')
        : 'Unreachable';
    const schedulerState = healthReport?.schedulerAlive ? 'Running' : 'Stopped';
    const pingLabel = healthReport?.gatewayPingMs === null || healthReport?.gatewayPingMs === undefined
        ? 'Unknown'
        : `${Math.round(healthReport.gatewayPingMs)}ms`;
    const healthSection = `
<section class="grid">
<div class="panel metric"><span>Discord</span><strong>${healthReport?.discordReady ? 'Ready' : 'Offline'}</strong></div>
<div class="panel metric"><span>Ping</span><strong>${escapeHtml(pingLabel)}</strong></div>
<div class="panel metric"><span>Guilds</span><strong>${escapeHtml(healthReport?.guilds ?? 0)}</strong></div>
<div class="panel metric"><span>Uptime</span><strong>${escapeHtml(Math.floor(Number(healthReport?.uptimeSeconds || 0) / 60))}m</strong></div>
<div class="panel metric"><span>Database</span><strong>${escapeHtml(databaseState)}</strong><small>${escapeHtml(healthReport?.database?.provider || 'unknown')}</small></div>
<div class="panel metric"><span>Scheduler</span><strong>${escapeHtml(schedulerState)}</strong></div>
</section>
<section class="panel"><h2>Schedulers</h2>
${['punishmentScheduler', 'memberCounterScheduler', 'mediaAnnouncementScheduler', 'levelingScheduler', 'scheduledMessageScheduler'].map(key => `<div class="row"><span>${escapeHtml(humanize(key))}</span><strong>${client[key] ? 'Running' : 'Stopped'}</strong></div>`).join('')}
</section>`;
    const moderationSection = `
${moderationSettingsSection}
${renderConfigSectionEditor('autoMod', 'Auto-Mod Rules', 'Configure invite links, mass mentions, caps/spam, suspicious domains, exemptions, and escalation ladder.', session, config.autoMod || {
    enabled: false,
    deleteMatches: true,
    rules: { inviteLinks: true, massMentions: true, caps: true, spam: true, suspiciousDomains: true },
    escalation: [{ after: 3, action: 'mute', durationMs: 600000 }],
})}
<section class="grid"><div class="panel wide"><h2>Recent Cases</h2>${moderationCases.slice(0, 20).map(item => `<div class="row"><span>#${escapeHtml(item.id)} ${escapeHtml(item.type)} ${escapeHtml(item.userTag || item.userId)}<br><span class="muted">${escapeHtml(item.reason)}</span></span><span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span></div>`).join('') || '<p class="muted">No cases yet.</p>'}</div><div class="panel side"><h2>Recent Notes</h2>${modNotes.slice(0, 10).map(item => `<div class="row"><span>${escapeHtml(item.userTag || item.userId)}<br><span class="muted">${escapeHtml(item.note)}</span></span></div>`).join('') || '<p class="muted">No notes yet.</p>'}</div></section>`;
    const ticketsSection = `
${ticketSettingsSection}
${renderTicketDashboard(ticketRecords, ticketTranscripts)}`;
    const communitySection = `
${welcomeSettingsSection}
${renderConfigSectionEditor('reactionRoles', 'Reaction Roles', 'Configure reaction-role panels. Use messageId, emoji, and roleId entries for each panel.', session, config.reactionRoles || { enabled: false, panels: [] })}
${renderConfigSectionEditor('rulesAgreement', 'Rules Agreement Panel', 'Configure a rules acknowledgement panel and verified role.', session, config.rulesAgreement || { enabled: false, channelId: '', roleId: '' })}
${renderConfigSectionEditor('birthdays', 'Birthday Reminders', 'Configure birthday reminder channel and timezone.', session, config.birthdays || { enabled: false, channelId: '', timezone: 'Europe/London' })}
${renderConfigSectionEditor('starboard', 'Starboard', 'Configure highlight/starboard emoji, threshold, and destination channel.', session, config.starboard || { enabled: false, channelId: '', emoji: '⭐', threshold: 3 })}
${renderConfigSectionEditor('pollTemplates', 'Poll Templates', 'Saved poll presets for staff workflows.', session, config.pollTemplates || [])}`;
    const levelingSection = `
${levelingSettingsForm}`;
    const voiceSection = `
${joinToCreateSettingsSection}
${renderVoiceDashboard(tempVoiceChannels, voiceActivity, dashboardGuild)}`;
    const mediaSection = `
${renderConfigSectionEditor('youtube', 'YouTube Targets', 'Manage channels to announce and their Discord destination channels.', session, config.youtube || {})}
${renderConfigSectionEditor('twitch', 'Twitch Targets', 'Manage Twitch channels, auth status, retry/error settings, and announcement templates.', session, config.twitch || {})}
${renderConfigSectionEditor('socialAnnouncements', 'Multi-Platform Targets', 'Configure TikTok, Instagram, Bluesky, and custom announcement templates. Integrations require provider APIs or feed endpoints.', session, config.socialAnnouncements || { tiktok: [], instagram: [], bluesky: [] })}`;
    const backupsSection = `
<section class="panel"><h2>Config Backups</h2><form method="post" action="/config/backup">${csrfInput(session)}<label>Label<input name="label" placeholder="before-risky-edit"></label><p><button class="success" type="submit">Create backup</button></p></form></section>
<section class="panel"><h2>Restore</h2>${configBackups.length ? configBackups.map(item => `<div class="row"><span>${escapeHtml(item.file)}<br><span class="muted">${escapeHtml(new Date(item.createdAt).toLocaleString())}</span></span><form method="post" action="/config/restore">${csrfInput(session)}<input type="hidden" name="file" value="${escapeHtml(item.file)}"><button class="danger" type="submit">Restore</button></form></div>`).join('') : '<p class="muted">No backups yet.</p>'}</section>`;
    const musicSection = `
${musicSettingsSection}
<section class="panel"><h2>Playback</h2><p class="muted">Use /music play, /music file, /music queue, /music skip, and /music stop in Discord.</p></section>`;
    const pageBodies = {
        overview: `${topbar}${overviewSection}${moduleLinksSection}<section class="grid">${logsSection}</section>`,
        audit: `${topbar}${auditSection}`,
        analytics: `${topbar}${analyticsSection}`,
        health: `${topbar}${healthSection}`,
        modules: `${topbar}${moduleSettingsSection}${moduleLinksSection}<section>${commandsHtml}</section>`,
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

    return renderLayout('Bot Dashboard', pageBodies[page] || pageBodies.overview, session.user, client, page, {
        guild: dashboardGuild,
    });
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
    app.use(express.static(path.join(__dirname, 'public'), {
        extensions: false,
        fallthrough: true,
        immutable: false,
    }));

    app.get('/health', async (req, res) => {
        const health = await buildPublicHealthReport(client);
        res.status(health.processAlive ? 200 : 500).json(health);
    });

    app.get('/ready', async (req, res) => {
        const health = await buildPublicHealthReport(client);
        res.status(health.ok ? 200 : 503).json(health);
    });

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
            if (!await canManageDashboard(user, guilds, currentSettings, client)) return res.status(403).send('You are not allowed to manage this dashboard.');

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

    app.use(requireAuth, requireDashboardAdmin(client));

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
        const allowedModules = new Set(groupCommands(client).map(([category]) => category));
        if (!allowedModules.has(req.body.module)) return res.status(400).send('Unknown module.');
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
        if (!client.commands.has(req.body.command)) return res.status(400).send('Unknown command.');
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
        if (!client.commands.has(commandName)) return res.status(400).send('Unknown command.');
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

    app.post('/dashboard-settings', requireAuth, requireCsrf, async (req, res) => {
        try {
            const activeGuildId = getDashboardGuild(client)?.id || getDashboardConfig().guildId || getStoredConfig().guildId;
            const channels = getGuildChannels(client);
            const roles = getGuildRoles(client);
            const allowedModules = groupCommands(client).map(([category]) => category);
            const result = parseDashboardSettings(req.body, {
                allowedModules,
                botMember: req.dashboardGuild?.members?.me,
                channels,
                enforceSendable: true,
                guildId: activeGuildId,
                roles,
            });

            if (['moderation', 'modules', 'music'].includes(result.section)) {
                updateConfig(config => {
                    applyDashboardSettings(config, req.body, {
                        allowedModules,
                        botMember: req.dashboardGuild?.members?.me,
                        channels,
                        enforceSendable: true,
                        guildId: activeGuildId,
                        roles,
                    });

                    const errors = validateConfig(config);
                    if (errors.length) {
                        throw new Error(errors.join(' '));
                    }

                    return config;
                });
            } else {
                await updateGuildSettings(activeGuildId, result.section, result.values, {
                    actorId: req.dashboardSession.user.id,
                    source: 'dashboard',
                });
            }

            appendDashboardLog('Dashboard settings saved', {
                section: result.section,
                userId: req.dashboardSession.user.id,
            });

            if (wantsJson(req)) {
                return res.json({ ok: true, message: result.message });
            }

            const page = dashboardSettingsPage(result.section);
            return res.redirect(`${page}?message=${encodeURIComponent(result.message)}`);
        } catch (error) {
            return sendSettingsError(req, res, client, error);
        }
    });

    app.post('/language-section', requireAuth, requireCsrf, (req, res) => {
        try {
            const section = req.body.section;
            const parsed = JSON.parse(req.body.content || '{}');
            assertSafeConfigObject(parsed);
            if (!section || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Language section must be a JSON object.');
            }

            const currentLanguage = language.loadLanguage();
            currentLanguage[section] = parsed;
            language.saveLanguage(currentLanguage);
            appendDashboardLog('Language section saved', { section, userId: req.dashboardSession.user.id });
            res.redirect('/language');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(safeErrorMessage(error, 'Language was not saved.'))}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/language-json', requireAuth, requireCsrf, (req, res) => {
        try {
            const parsed = JSON.parse(req.body.language);
            assertSafeConfigObject(parsed);
            language.saveLanguage(parsed);
            appendDashboardLog('language.json saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/language?message=language.json%20saved');
        } catch (error) {
            res.status(400).send(renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${escapeHtml(safeErrorMessage(error, 'Language was not saved.'))}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/send-message', requireAuth, requireCsrf, async (req, res) => {
        try {
            const activeGuild = req.dashboardGuild || getDashboardGuild(client);
            const activeGuildId = activeGuild?.id || getDashboardConfig().guildId || getStoredConfig().guildId;
            const needsChannel = req.body.saveTemplate !== '1';
            const channel = needsChannel
                ? await resolveDashboardChannel(activeGuild, req.body.channelId, {
                    label: 'Message channel',
                    types: [ChannelType.GuildAnnouncement, ChannelType.GuildText],
                    requireSendable: true,
                })
                : null;
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
                    guildId: activeGuildId,
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
            const redactedMessage = safeErrorMessage(error);
            const safeMessage = /channel|template|message content|future date/i.test(redactedMessage)
                ? redactedMessage
                : 'Discord rejected the message. Check the bot permissions and message content.';
            res.status(/channel|template|message content|future date/i.test(redactedMessage) ? 400 : 500)
                .send(renderLayout('Message failed', `<section class="panel"><h2>Message failed</h2><p>${escapeHtml(safeMessage)}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/embed-template/delete', requireAuth, requireCsrf, async (req, res) => {
        const activeGuildId = req.dashboardGuild?.id || getDashboardConfig().guildId || getStoredConfig().guildId;
        const template = (await listEmbedTemplates(activeGuildId)).find(item => item.id === req.body.id);
        if (!template) {
            return res.status(404).send(renderLayout('Template not found', '<section class="panel"><h2>Template not found</h2><p>That template is not available for this server.</p></section>', req.dashboardSession.user, client));
        }
        await deleteEmbedTemplate(activeGuildId, req.body.id);
        appendDashboardLog('Embed template deleted', { id: req.body.id, userId: req.dashboardSession.user.id });
        res.redirect('/sender?message=Template%20deleted');
    });

    app.post('/config-section', requireAuth, requireCsrf, (req, res) => {
        try {
            const section = String(req.body.section || '').trim();
            if (!editableConfigSectionPages[section]) {
                return res.status(400).send(renderLayout('Invalid section', '<section class="panel"><h2>Invalid config section</h2><p>Use the full config editor for this section.</p></section>', req.dashboardSession.user, client));
            }

            const parsed = JSON.parse(req.body.json || '{}');
            assertSafeConfigObject(parsed);
            updateConfig(config => {
                validateConfigSectionEdit(section, parsed, config);
                config[section] = parsed;
                return config;
            });
            appendDashboardLog('Config section saved', { section, userId: req.dashboardSession.user.id });
            res.redirect(`/${editableConfigSectionPages[section] || 'config'}?message=Saved`);
        } catch (error) {
            res.status(400).send(renderLayout('Invalid JSON', `<section class="panel"><h2>Invalid JSON</h2><p>${escapeHtml(safeErrorMessage(error, 'Config section was not saved.'))}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/config-json', requireAuth, requireCsrf, (req, res) => {
        try {
            const parsedConfig = JSON.parse(req.body.config);
            const restoredConfig = buildRestoredConfig(parsedConfig, getStoredConfig());
            saveConfig(restoredConfig);
            appendDashboardLog('Config saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/config');
        } catch (error) {
            const message = error instanceof SyntaxError
                ? 'The config was not saved. Use the browser back button and fix the JSON.'
                : safeErrorMessage(error, 'The config was not saved.');
            res.status(400).send(renderLayout('Invalid config', `<section class="panel"><h2>Invalid config</h2><p>${escapeHtml(message)}</p></section>`, req.dashboardSession.user, client));
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
            res.status(400).send(renderLayout('Restore failed', `<section class="panel"><h2>Restore failed</h2><p>${escapeHtml(safeErrorMessage(error, 'Backup was not restored.'))}</p></section>`, req.dashboardSession.user, client));
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
    assertSafeConfigObject,
    buildRestoredConfig,
    canManageDashboard,
    createConfigBackup,
    createSessionToken,
    getOAuthStateCount: () => {
        cleanupExpiringMaps();
        return states.size;
    },
    makeDiscordOauthUrl,
    parseCookies,
    requireCsrf,
    redactSensitiveConfig,
    resolveDashboardChannel,
    restoreConfigBackup,
    restoreRedactedSecrets,
    startDashboard,
    userCanAdminDashboard,
    validateConfigSectionEdit,
    verifySessionToken,
};
