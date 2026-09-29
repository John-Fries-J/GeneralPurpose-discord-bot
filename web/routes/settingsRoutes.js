function registerSettingsRoutes(app, client, deps) {
    app.post('/toggle-module', deps.requireCsrf, (req, res) => {
        const enabled = req.body.enabled === 'on';
        const allowedModules = new Set(deps.groupCommands(client).map(([category]) => category));
        if (!allowedModules.has(req.body.module)) return res.status(400).send('Unknown module.');
        deps.updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.modules = config.commandSettings.modules || {};
            config.commandSettings.modules[req.body.module] = enabled;
            return config;
        });
        deps.appendDashboardLog('Module toggle updated', { module: req.body.module, enabled, userId: req.dashboardSession.user.id });
        res.redirect(`/modules#module-${deps.slug(req.body.module)}`);
    });

    app.post('/toggle-command', deps.requireCsrf, (req, res) => {
        const enabled = req.body.enabled === 'on';
        if (!client.commands.has(req.body.command)) return res.status(400).send('Unknown command.');
        deps.updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.commands = config.commandSettings.commands || {};
            config.commandSettings.commands[req.body.command] = enabled;
            return config;
        });
        deps.appendDashboardLog('Command toggle updated', { command: req.body.command, enabled, userId: req.dashboardSession.user.id });
        res.redirect('/commands');
    });

    app.post('/command-access', deps.requireCsrf, (req, res) => {
        const commandName = req.body.command;
        if (!client.commands.has(commandName)) return res.status(400).send('Unknown command.');
        const access = {
            allowRoleIds: deps.normalizeIdList(req.body.allowRoleIds),
            allowUserIds: deps.normalizeIdList(req.body.allowUserIds),
            denyRoleIds: deps.normalizeIdList(req.body.denyRoleIds),
            denyUserIds: deps.normalizeIdList(req.body.denyUserIds),
        };

        deps.updateConfig(config => {
            config.commandSettings = config.commandSettings || {};
            config.commandSettings.access = config.commandSettings.access || {};

            if (Object.values(access).every(list => list.length === 0)) {
                delete config.commandSettings.access[commandName];
            } else {
                config.commandSettings.access[commandName] = access;
            }

            return config;
        });

        deps.appendDashboardLog('Command access updated', { command: commandName, userId: req.dashboardSession.user.id });
        res.redirect('/commands');
    });

    app.post('/dashboard-settings', deps.requireCsrf, async (req, res) => {
        try {
            const activeGuildId = deps.getDashboardGuild(client)?.id || deps.getDashboardConfig().guildId || deps.getStoredConfig().guildId;
            const channels = deps.getGuildChannels(client);
            const roles = deps.getGuildRoles(client);
            const allowedModules = deps.groupCommands(client).map(([category]) => category);
            const result = deps.parseDashboardSettings(req.body, {
                allowedModules,
                botMember: req.dashboardGuild?.members?.me,
                channels,
                enforceSendable: true,
                guildId: activeGuildId,
                roles,
            });

            if (['moderation', 'modules', 'music'].includes(result.section)) {
                deps.updateConfig(config => {
                    deps.applyDashboardSettings(config, req.body, {
                        allowedModules,
                        botMember: req.dashboardGuild?.members?.me,
                        channels,
                        enforceSendable: true,
                        guildId: activeGuildId,
                        roles,
                    });

                    const errors = deps.validateConfig(config);
                    if (errors.length) {
                        throw new Error(errors.join(' '));
                    }

                    return config;
                });
            } else {
                await deps.updateGuildSettings(activeGuildId, result.section, result.values, {
                    actorId: req.dashboardSession.user.id,
                    source: 'dashboard',
                });
            }

            deps.appendDashboardLog('Dashboard settings saved', {
                section: result.section,
                userId: req.dashboardSession.user.id,
            });

            if (deps.wantsJson(req)) {
                return res.json({ ok: true, message: result.message });
            }

            const page = deps.dashboardSettingsPage(result.section);
            return res.redirect(`${page}?message=${encodeURIComponent(result.message)}`);
        } catch (error) {
            return deps.sendSettingsError(req, res, client, error);
        }
    });
}

module.exports = {
    registerSettingsRoutes,
};
