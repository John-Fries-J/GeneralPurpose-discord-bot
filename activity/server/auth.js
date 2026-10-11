const crypto = require('node:crypto');
const { getConfig } = require('../../utils/config');
const { parseCookies } = require('../../web/services/dashboardAuth');

const sessionMaxAgeMs = 12 * 60 * 60 * 1000;
const activityCookieName = 'activity_session';

class ActivityAuthError extends Error {
    constructor(code, message, status = 401) {
        super(message);
        this.name = 'ActivityAuthError';
        this.code = code;
        this.status = status;
    }
}

function getActivityConfig(config = getConfig(), env = process.env) {
    const dashboard = config.dashboard || {};
    const activity = config.activity || {};
    const clientId = env.DISCORD_ACTIVITY_CLIENT_ID || activity.clientId || config.clientId || dashboard.oauth?.clientId || '';
    const publicUrl = env.DISCORD_ACTIVITY_PUBLIC_URL || activity.publicUrl || dashboard.publicUrl || '';

    return {
        enabled: activity.enabled === true,
        publicUrl,
        clientId,
        clientSecret: env.DISCORD_ACTIVITY_CLIENT_SECRET || env.DISCORD_OAUTH_CLIENT_SECRET || dashboard.oauth?.clientSecret || '',
        sessionSecret: env.DISCORD_ACTIVITY_SESSION_SECRET || env.DASHBOARD_SESSION_SECRET || dashboard.sessionSecret || env.DISCORD_ACTIVITY_CLIENT_SECRET || config.token || 'development-activity-session-secret',
        voiceControls: activity.voiceControls !== false,
        musicControls: activity.musicControls !== false,
    };
}

function getPublicActivityConfig(config = getActivityConfig()) {
    return {
        enabled: config.enabled,
        clientId: config.clientId,
        publicUrl: config.publicUrl,
        voiceControls: config.voiceControls,
        musicControls: config.musicControls,
    };
}

function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value, settings = getActivityConfig()) {
    return crypto.createHmac('sha256', settings.sessionSecret).update(value).digest('base64url');
}

function createActivitySessionToken(session, settings = getActivityConfig()) {
    const payload = base64UrlEncode(JSON.stringify(session));
    return `${payload}.${signValue(payload, settings)}`;
}

function verifyActivitySessionToken(token, settings = getActivityConfig()) {
    if (!token || !token.includes('.')) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = signValue(payload, settings);

    try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
        const session = JSON.parse(base64UrlDecode(payload));
        if (!session?.user?.id || !session.expiresAt || session.expiresAt <= Date.now()) return null;
        return session;
    } catch {
        return null;
    }
}

function createActivitySession(user, metadata = {}) {
    return {
        user: {
            id: String(user.id),
            username: user.username || user.global_name || user.id,
            globalName: user.global_name || null,
            avatar: user.avatar || null,
        },
        guildId: metadata.guildId || null,
        channelId: metadata.channelId || null,
        instanceId: metadata.instanceId || null,
        csrfToken: crypto.randomBytes(32).toString('base64url'),
        createdAt: Date.now(),
        expiresAt: Date.now() + sessionMaxAgeMs,
    };
}

function getActivitySession(req, settings = getActivityConfig()) {
    const cookies = parseCookies(req.headers.cookie);
    return verifyActivitySessionToken(cookies[activityCookieName], settings);
}

function setActivityCookie(res, session, settings = getActivityConfig()) {
    const token = createActivitySessionToken(session, settings);
    const secureCookie = settings.publicUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
    const sameSite = secureCookie ? 'None' : 'Lax';
    res.setHeader('Set-Cookie', `${activityCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${Math.floor(sessionMaxAgeMs / 1000)}${secureCookie ? '; Secure' : ''}`);
}

function requireActivityAuth(req, res, next) {
    const settings = getActivityConfig();
    if (!settings.enabled) {
        return res.status(404).json({ ok: false, error: { code: 'activity_disabled', message: 'Discord Activity is disabled.' } });
    }

    const session = getActivitySession(req, settings);
    if (!session) {
        return res.status(401).json({ ok: false, error: { code: 'unauthenticated', message: 'Authenticate through Discord first.' } });
    }

    req.activitySession = session;
    return next();
}

function requireActivityCsrf(req, res, next) {
    const session = req.activitySession || getActivitySession(req);
    const token = req.get('x-activity-csrf');
    if (!session?.csrfToken || !token || token !== session.csrfToken) {
        return res.status(403).json({ ok: false, error: { code: 'bad_csrf', message: 'Invalid Activity request token.' } });
    }
    return next();
}

async function exchangeActivityCode(settings, code) {
    if (!settings.clientId || !settings.clientSecret) {
        throw new ActivityAuthError('activity_oauth_not_configured', 'Activity OAuth is not configured on the server.', 503);
    }

    const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            grant_type: 'authorization_code',
            code,
        }),
    });

    if (!response.ok) {
        throw new ActivityAuthError('discord_token_exchange_failed', `Discord token exchange failed with ${response.status}.`, 401);
    }

    return response.json();
}

async function fetchActivityDiscordUser(accessToken) {
    const response = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new ActivityAuthError('discord_user_lookup_failed', 'Discord profile lookup failed.', 401);
    }
    return response.json();
}

function validateActivityCode(value) {
    const code = String(value || '').trim();
    if (code.length < 8 || code.length > 4096) {
        throw new ActivityAuthError('invalid_code', 'Discord authorization code is invalid.', 400);
    }
    return code;
}

module.exports = {
    ActivityAuthError,
    createActivitySession,
    createActivitySessionToken,
    exchangeActivityCode,
    fetchActivityDiscordUser,
    getActivityConfig,
    getActivitySession,
    getPublicActivityConfig,
    requireActivityAuth,
    requireActivityCsrf,
    setActivityCookie,
    sessionMaxAgeMs,
    validateActivityCode,
    verifyActivitySessionToken,
};
