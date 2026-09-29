function registerConfigRoutes(app, client, deps) {
    app.post('/config-section', deps.requireCsrf, (req, res) => {
        try {
            const section = String(req.body.section || '').trim();
            if (!deps.editableConfigSectionPages[section]) {
                return res.status(400).send(deps.renderLayout('Invalid section', '<section class="panel"><h2>Invalid config section</h2><p>Use the full config editor for this section.</p></section>', req.dashboardSession.user, client));
            }

            const parsed = JSON.parse(req.body.json || '{}');
            deps.assertSafeConfigObject(parsed);
            deps.updateConfig(config => {
                deps.validateConfigSectionEdit(section, parsed, config);
                config[section] = parsed;
                return config;
            });
            deps.appendDashboardLog('Config section saved', { section, userId: req.dashboardSession.user.id });
            res.redirect(`/${deps.editableConfigSectionPages[section] || 'config'}?message=Saved`);
        } catch (error) {
            res.status(400).send(deps.renderLayout('Invalid JSON', `<section class="panel"><h2>Invalid JSON</h2><p>${deps.escapeHtml(deps.safeErrorMessage(error, 'Config section was not saved.'))}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/config-json', deps.requireCsrf, (req, res) => {
        try {
            const parsedConfig = JSON.parse(req.body.config);
            const restoredConfig = deps.buildRestoredConfig(parsedConfig, deps.getStoredConfig());
            deps.saveConfig(restoredConfig);
            deps.appendDashboardLog('Config saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/config');
        } catch (error) {
            const message = error instanceof SyntaxError
                ? 'The config was not saved. Use the browser back button and fix the JSON.'
                : deps.safeErrorMessage(error, 'The config was not saved.');
            res.status(400).send(deps.renderLayout('Invalid config', `<section class="panel"><h2>Invalid config</h2><p>${deps.escapeHtml(message)}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/config/backup', deps.requireCsrf, (req, res) => {
        const file = deps.createConfigBackup(req.body.label);
        deps.appendDashboardLog('Config backup created', { file, userId: req.dashboardSession.user.id });
        res.redirect('/backups?message=Backup%20created');
    });

    app.post('/config/restore', deps.requireCsrf, (req, res) => {
        try {
            deps.createConfigBackup('before-restore');
            deps.restoreConfigBackup(req.body.file);
            deps.appendDashboardLog('Config backup restored', { file: req.body.file, userId: req.dashboardSession.user.id });
            res.redirect('/backups?message=Backup%20restored');
        } catch (error) {
            res.status(400).send(deps.renderLayout('Restore failed', `<section class="panel"><h2>Restore failed</h2><p>${deps.escapeHtml(deps.safeErrorMessage(error, 'Backup was not restored.'))}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/logs/clear', deps.requireCsrf, (req, res) => {
        deps.clearDashboardLogs();
        deps.appendDashboardLog('Dashboard logs cleared', { userId: req.dashboardSession.user.id });
        res.redirect('/logs');
    });
}

module.exports = {
    registerConfigRoutes,
};
