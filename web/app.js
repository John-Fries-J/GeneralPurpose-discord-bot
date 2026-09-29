const path = require('node:path');
const express = require('express');
const { securityHeaders } = require('./middleware/security');
const { registerAuthRoutes } = require('./routes/authRoutes');
const { registerConfigRoutes } = require('./routes/configRoutes');
const { registerContentRoutes } = require('./routes/contentRoutes');
const { registerHealthRoutes } = require('./routes/healthRoutes');
const { registerPageRoutes } = require('./routes/pageRoutes');
const { registerSettingsRoutes } = require('./routes/settingsRoutes');

function createDashboardApp(client, deps) {
    const app = express();
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(securityHeaders);
    app.use(express.static(path.join(__dirname, 'public'), {
        extensions: false,
        fallthrough: true,
        immutable: false,
    }));

    registerHealthRoutes(app, client, deps);
    registerAuthRoutes(app, client, deps);

    app.use(deps.requireAuth, deps.requireDashboardAdmin(client));

    registerPageRoutes(app, client, deps);
    registerSettingsRoutes(app, client, deps);
    registerContentRoutes(app, client, deps);
    registerConfigRoutes(app, client, deps);

    return app;
}

module.exports = {
    createDashboardApp,
};
