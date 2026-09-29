function registerHealthRoutes(app, client, deps) {
    app.get('/health', async (req, res) => {
        const health = await deps.buildPublicHealthReport(client);
        res.status(health.processAlive ? 200 : 500).json(health);
    });

    app.get('/ready', async (req, res) => {
        const health = await deps.buildPublicHealthReport(client);
        res.status(health.ok ? 200 : 503).json(health);
    });
}

module.exports = {
    registerHealthRoutes,
};
