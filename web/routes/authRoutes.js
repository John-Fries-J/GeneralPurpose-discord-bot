function registerAuthRoutes(app, client, deps) {
    app.get('/login', (req, res) => {
        const currentSettings = deps.getDashboardConfig();
        if (!currentSettings.oauth.clientId || !currentSettings.oauth.clientSecret) {
            return res.send(deps.renderLayout('Dashboard setup required', '<section class="auth-card"><h2>OAuth setup required</h2><p>Add dashboard.oauth.clientId and dashboard.oauth.clientSecret to config.json, or set DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET.</p></section>', null, client));
        }

        return res.redirect(deps.makeDiscordOauthUrl(currentSettings));
    });

    app.get('/auth/discord/callback', async (req, res) => {
        try {
            if (!deps.consumeOauthState(req.query.state)) return res.status(403).send('Invalid OAuth state.');

            const currentSettings = deps.getDashboardConfig();
            const token = await deps.exchangeDiscordCode(currentSettings, req.query.code);
            const { user, guilds } = await deps.fetchDiscordUser(token.access_token);
            if (!await deps.canManageDashboard(user, guilds, currentSettings, client)) return res.status(403).send('You are not allowed to manage this dashboard.');

            const session = deps.createDashboardSession(user);
            const sessionToken = deps.createSessionToken(session);
            deps.appendDashboardLog('Dashboard login', { userId: user.id });
            const secureCookie = currentSettings.publicUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
            res.setHeader('Set-Cookie', `dashboard_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(deps.sessionMaxAgeMs / 1000)}${secureCookie ? '; Secure' : ''}`);
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
}

module.exports = {
    registerAuthRoutes,
};
