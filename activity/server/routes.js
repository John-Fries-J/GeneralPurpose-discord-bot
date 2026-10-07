const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { logger } = require('../../utils/logger');
const {
    addTrackFromActivity,
    getMusicState,
    moveMusicTrack,
    pauseMusic,
    removeMusicTrack,
    resumeMusic,
    setMusicVolume,
    skipMusic,
    stopMusic,
} = require('../../services/musicControlService');
const {
    deleteOwnedVoiceChannel,
    getTemporaryVoiceState,
    lockOwnedVoiceChannel,
    permitVoiceMember,
    rejectVoiceMember,
    renameOwnedVoiceChannel,
    setOwnedVoiceLimit,
    transferOwnedVoiceChannel,
    unlockOwnedVoiceChannel,
} = require('../../services/voiceControlService');
const {
    ActivityAuthError,
    createActivitySession,
    exchangeActivityCode,
    fetchActivityDiscordUser,
    getActivityConfig,
    getPublicActivityConfig,
    requireActivityAuth,
    requireActivityCsrf,
    setActivityCookie,
    validateActivityCode,
} = require('./auth');
const { ActivityApiError, readActivityContext, serializeContext, verifyActivityContext } = require('./activityService');
const { activityRateLimiter } = require('./rateLimit');
const { openActivityEventStream } = require('./realtime');

const activityLogger = logger.child({ component: 'activity' });

function statusForError(error) {
    return Number(error?.status || error?.statusCode || 500);
}

function codeForError(error) {
    if (error?.code) return error.code;
    if (statusForError(error) >= 500) return 'internal_error';
    return 'bad_request';
}

function messageForError(error) {
    if (error instanceof ActivityAuthError || error instanceof ActivityApiError || error?.name?.endsWith?.('Error')) {
        return error.message || 'Activity request failed.';
    }
    return 'Activity request failed.';
}

function sendError(res, error, context = {}) {
    const status = statusForError(error);
    const code = codeForError(error);
    const message = status >= 500 ? 'Activity request failed.' : messageForError(error);
    if (status >= 500) {
        activityLogger.error('Activity API failed', { error, ...context });
    } else {
        activityLogger.warn('Activity API rejected request', { code, message, ...context });
    }
    return res.status(status).json({ ok: false, error: { code, message } });
}

function sendOk(res, data = {}) {
    return res.json({ ok: true, ...data });
}

function requireActivityFeature(feature) {
    return (req, res, next) => {
        const settings = getActivityConfig();
        if (feature === 'voice' && !settings.voiceControls) {
            return res.status(403).json({ ok: false, error: { code: 'feature_disabled', message: 'Voice controls are disabled.' } });
        }
        if (feature === 'music' && !settings.musicControls) {
            return res.status(403).json({ ok: false, error: { code: 'feature_disabled', message: 'Music controls are disabled.' } });
        }
        return next();
    };
}

function captureActivityContext(req, res, next) {
    try {
        req.activityContext = readActivityContext(req);
        return next();
    } catch (error) {
        return sendError(res, error, { path: req.path });
    }
}

function asyncRoute(handler) {
    return async (req, res) => {
        try {
            return await handler(req, res);
        } catch (error) {
            return sendError(res, error, {
                path: req.path,
                userId: req.activitySession?.user?.id,
                guildId: req.activityContext?.guildId,
            });
        }
    };
}

function registerActivityApiRoutes(app, client) {
    app.get('/api/activity/config', (req, res) => {
        sendOk(res, { config: getPublicActivityConfig() });
    });

    app.post('/api/activity/token', captureActivityContext, asyncRoute(async (req, res) => {
        const settings = getActivityConfig();
        if (!settings.enabled) throw new ActivityAuthError('activity_disabled', 'Discord Activity is disabled.', 404);

        const code = validateActivityCode(req.body?.code);
        const token = await exchangeActivityCode(settings, code);
        const user = await fetchActivityDiscordUser(token.access_token);
        if (req.activityContext.guildId) {
            await verifyActivityContext(client, { user }, req.activityContext);
        }

        const session = createActivitySession(user, req.activityContext);
        setActivityCookie(res, session, settings);
        activityLogger.info('Activity login', {
            userId: user.id,
            guildId: req.activityContext.guildId,
            channelId: req.activityContext.channelId,
        });

        sendOk(res, {
            accessToken: token.access_token,
            expiresIn: token.expires_in,
            csrfToken: session.csrfToken,
            me: session.user,
        });
    }));

    const authed = [requireActivityAuth, captureActivityContext];
    const mutating = [requireActivityAuth, requireActivityCsrf, captureActivityContext];

    app.get('/api/activity/me', requireActivityAuth, (req, res) => {
        sendOk(res, { me: req.activitySession.user, csrfToken: req.activitySession.csrfToken });
    });

    app.get('/api/activity/context', ...authed, asyncRoute(async (req, res) => {
        const verified = await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { context: serializeContext(verified) });
    }));

    app.get('/api/activity/events', ...authed, asyncRoute(async (req, res) => {
        const verified = await verifyActivityContext(client, req.activitySession, req.activityContext);
        openActivityEventStream(req, res, {
            guildId: verified.guild.id,
            instanceId: req.activityContext.instanceId,
        });
    }));

    app.get('/api/activity/voice', ...authed, requireActivityFeature('voice'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { voice: await getTemporaryVoiceState(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/voice/name', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceRename'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await renameOwnedVoiceChannel(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.name, 'Voice owner renamed channel from Activity') });
    }));

    app.post('/api/activity/voice/limit', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceLimit'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await setOwnedVoiceLimit(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.limit, 'Voice owner changed user limit from Activity') });
    }));

    app.post('/api/activity/voice/lock', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceLock'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await lockOwnedVoiceChannel(client, req.activityContext.guildId, req.activitySession.user.id, 'Voice owner locked channel from Activity') });
    }));

    app.post('/api/activity/voice/unlock', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceLock'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await unlockOwnedVoiceChannel(client, req.activityContext.guildId, req.activitySession.user.id, 'Voice owner unlocked channel from Activity') });
    }));

    app.post('/api/activity/voice/permit', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceMember'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await permitVoiceMember(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.userId, 'Voice owner permitted user from Activity') });
    }));

    app.post('/api/activity/voice/reject', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceMember'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await rejectVoiceMember(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.userId, 'Voice owner rejected user from Activity') });
    }));

    app.post('/api/activity/voice/transfer', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceMember'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { channel: await transferOwnedVoiceChannel(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.userId, 'Voice owner transferred channel from Activity') });
    }));

    app.post('/api/activity/voice/delete', ...mutating, requireActivityFeature('voice'), activityRateLimiter('voiceDelete'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { result: await deleteOwnedVoiceChannel(client, req.activityContext.guildId, req.activitySession.user.id, 'Voice owner deleted channel from Activity') });
    }));

    app.get('/api/activity/music', ...authed, requireActivityFeature('music'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await getMusicState(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/music/pause', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicControl'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await pauseMusic(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/music/resume', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicControl'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await resumeMusic(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/music/skip', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicControl'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await skipMusic(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/music/stop', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicControl'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await stopMusic(client, req.activityContext.guildId, req.activitySession.user.id) });
    }));

    app.post('/api/activity/music/volume', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicVolume'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await setMusicVolume(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.volume) });
    }));

    app.post('/api/activity/music/add', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicSearch'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await addTrackFromActivity(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.query, req.activityContext) });
    }));

    app.post('/api/activity/music/remove', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicQueue'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await removeMusicTrack(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.index) });
    }));

    app.post('/api/activity/music/move', ...mutating, requireActivityFeature('music'), activityRateLimiter('musicQueue'), asyncRoute(async (req, res) => {
        await verifyActivityContext(client, req.activitySession, req.activityContext);
        sendOk(res, { music: await moveMusicTrack(client, req.activityContext.guildId, req.activitySession.user.id, req.body?.from, req.body?.to) });
    }));
}

function registerActivityStaticRoutes(app) {
    const distPath = path.join(__dirname, '..', 'client', 'dist');
    if (!fs.existsSync(distPath)) {
        app.get('/activity', (req, res) => {
            res.status(503).send('Activity frontend has not been built. Run npm run activity:build.');
        });
        return;
    }

    app.use('/activity', express.static(distPath, {
        extensions: false,
        fallthrough: true,
        immutable: true,
        maxAge: '1h',
    }));

    app.get('/activity/*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

function registerActivityRoutes(app, client) {
    const settings = getActivityConfig();
    if (!settings.enabled) return false;

    registerActivityApiRoutes(app, client);
    registerActivityStaticRoutes(app);
    activityLogger.info('Discord Activity routes enabled', {
        publicUrl: settings.publicUrl,
        voiceControls: settings.voiceControls,
        musicControls: settings.musicControls,
    });
    return true;
}

module.exports = {
    registerActivityApiRoutes,
    registerActivityRoutes,
    registerActivityStaticRoutes,
};
