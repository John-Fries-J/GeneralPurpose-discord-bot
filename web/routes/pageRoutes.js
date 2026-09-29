function registerPageRoutes(app, client, deps) {
    const renderPage = page => async (req, res) => {
        res.send(await deps.renderDashboard(client, req.dashboardSession, req.query.message || '', page));
    };

    app.get('/', renderPage('overview'));
    app.get('/audit', renderPage('audit'));
    app.get('/analytics', renderPage('analytics'));
    app.get('/health-page', renderPage('health'));
    app.get('/modules', renderPage('modules'));
    app.get('/commands', renderPage('commands'));
    app.get('/moderation', renderPage('moderation'));
    app.get('/tickets', renderPage('tickets'));
    app.get('/transcripts/:id', async (req, res) => {
        const transcript = await deps.getTicketTranscript(req.params.id);
        if (!transcript) {
            return res.status(404).send(deps.renderLayout('Transcript not found', '<section class="panel"><h2>Transcript not found</h2><p>That transcript does not exist.</p></section>', req.dashboardSession.user, client, 'tickets'));
        }

        if (!await deps.canViewTranscript(client, req.dashboardSession, transcript)) {
            return res.status(403).send(deps.renderLayout('Transcript unavailable', '<section class="panel"><h2>Transcript unavailable</h2><p>You are not allowed to view this transcript.</p></section>', req.dashboardSession.user, client, 'tickets'));
        }

        return res.type('html').send(transcript.html);
    });
    app.get('/community', renderPage('community'));
    app.get('/leveling', renderPage('leveling'));
    app.get('/voice', renderPage('voice'));
    app.get('/media', renderPage('media'));
    app.get('/music', renderPage('music'));
    app.get('/language', renderPage('language'));
    app.get('/sender', renderPage('sender'));
    app.get('/config', renderPage('config'));
    app.get('/backups', renderPage('backups'));
    app.get('/logs', renderPage('logs'));
}

module.exports = {
    registerPageRoutes,
};
