const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const configService = require('../../utils/config');
const { appendDashboardLog } = require('../../utils/dashboardLogs');
const { getGuildSettings } = require('../../utils/guildConfig');
const { normalizeIdList } = require('../../utils/permissions');

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
    const config = configService.getConfig();
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
    const config = configService.getConfig();
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

function createDashboardSession(user) {
    return {
        user,
        createdAt: Date.now(),
        expiresAt: Date.now() + sessionMaxAgeMs,
        csrfToken: crypto.randomBytes(32).toString('hex'),
    };
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

function getConfiguredDashboardAdminUserIds(config = configService.getConfig()) {
    return new Set(normalizeIdList(config.devs));
}

function getDashboardGuild(client) {
    const settings = getDashboardConfig();
    return settings.guildId ? client.guilds?.cache?.get(settings.guildId) : client.guilds?.cache?.first?.();
}

async function userCanAdminDashboard(client, userId, guild) {
    if (!userId || !guild?.id) return false;
    const config = configService.getConfig();
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

function consumeOauthState(state) {
    const expiry = states.get(state);
    states.delete(state);
    return Boolean(expiry && expiry >= Date.now());
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
    const config = configService.getConfig();
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
    const config = configService.getConfig();
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

module.exports = {
    canManageDashboard,
    canViewTranscript,
    consumeOauthState,
    createDashboardSession,
    createSessionToken,
    exchangeDiscordCode,
    fetchDiscordUser,
    getDashboardConfig,
    getDashboardGuild,
    getOAuthStateCount: () => {
        cleanupExpiringMaps();
        return states.size;
    },
    getSession,
    makeDiscordOauthUrl,
    parseCookies,
    requireAuth,
    requireCsrf,
    requireDashboardAdmin,
    sessionMaxAgeMs,
    userCanAdminDashboard,
    verifySessionToken,
};
