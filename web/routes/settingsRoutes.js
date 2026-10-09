function registerSettingsRoutes(app, client, deps) {
    const {
        cancelLevelImport,
        previewRoleRecovery,
        startLevelImport,
    } = require('../../utils/levelingImport');
    const { createXpTest, previewLevelTest, rollbackLevelTest } = require('../../utils/levelingTests');
    const {
        removeLevelRoleMapping,
        upsertLevelRoleMapping,
    } = require('../../utils/store');

    const activeGuild = () => deps.getDashboardGuild(client);
    const redirectLeveling = (res, message) => res.redirect(`/leveling?message=${encodeURIComponent(message)}`);
    const handleLevelingAction = handler => async (req, res) => {
        try {
            const guild = activeGuild();
            if (!guild) return res.status(400).send('Dashboard guild is not available.');
            const message = await handler(req, guild);
            return redirectLeveling(res, message);
        } catch (error) {
            return deps.sendSettingsError(req, res, client, error);
        }
    };

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

    app.post('/leveling/import-preview', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const created = await startLevelImport(client, guild, {
            dryRun: true,
            includeRoleRecovery: true,
            policy: 'max',
            createdBy: req.dashboardSession.user.id,
        });
        if (!created.ok) return `A level import is already active: ${created.job.id}`;
        return `Started dry-run level import ${created.job.id}.`;
    }));

    app.post('/leveling/import-history', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        if (String(req.body.confirm || '').toUpperCase() !== 'APPLY') {
            throw new Error('Type APPLY before applying historical XP.');
        }
        const created = await startLevelImport(client, guild, {
            dryRun: false,
            includeRoleRecovery: true,
            policy: 'max',
            createdBy: req.dashboardSession.user.id,
        });
        if (!created.ok) return `A level import is already active: ${created.job.id}`;
        return `Started applying level import ${created.job.id}.`;
    }));

    app.post('/leveling/import-cancel', deps.requireCsrf, handleLevelingAction(async req => {
        const job = await cancelLevelImport(req.body.jobId);
        if (!job) throw new Error('Level import job not found.');
        return `Cancellation requested for ${job.id}.`;
    }));

    app.post('/leveling/role-map/add', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const roleId = String(req.body.roleId || '');
        const minimumLevel = Number(req.body.minimumLevel || 0);
        if (!guild.roles.cache.has(roleId)) throw new Error('Choose a role from this server.');
        if (!Number.isInteger(minimumLevel) || minimumLevel < 1) throw new Error('Minimum level must be a positive whole number.');
        await upsertLevelRoleMapping({
            guildId: guild.id,
            roleId,
            minimumLevel,
            createdBy: req.dashboardSession.user.id,
        });
        return 'Role recovery mapping saved.';
    }));

    app.post('/leveling/role-map/remove', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        await removeLevelRoleMapping(guild.id, String(req.body.roleId || ''));
        return 'Role recovery mapping removed.';
    }));

    app.post('/leveling/role-recovery-preview', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const result = await previewRoleRecovery(guild, { apply: false });
        return `Previewed role recovery: ${result.membersMatched} matched, ${result.wouldChange} would change.`;
    }));

    app.post('/leveling/role-recovery-apply', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        if (String(req.body.confirm || '').toUpperCase() !== 'APPLY') {
            throw new Error('Type APPLY before applying role recovery.');
        }
        const result = await previewRoleRecovery(guild, {
            apply: true,
            adminId: req.dashboardSession.user.id,
        });
        return `Applied role recovery to ${result.applied} members.`;
    }));

    app.post('/leveling/test-preview', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const member = await guild.members.fetch(String(req.body.userId || '')).catch(() => null);
        if (!member) throw new Error('Member not found.');
        const level = Number(req.body.level || 0);
        const preview = await previewLevelTest(member, { level, awardMissingRoles: true });
        return `Preview: level ${preview.before.level} -> ${preview.after.level}, XP delta ${preview.delta}.`;
    }));

    app.post('/leveling/test-set', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const member = await guild.members.fetch(String(req.body.userId || '')).catch(() => null);
        if (!member) throw new Error('Member not found.');
        const level = Number(req.body.level || 0);
        const result = await createXpTest(member, {
            adminId: req.dashboardSession.user.id,
            level,
            previewOnly: false,
            applyRoles: true,
            awardMissingRoles: true,
            removeObsoleteRoles: false,
        });
        return `Created level test session ${result.session.id}.`;
    }));

    app.post('/leveling/test-rollback', deps.requireCsrf, handleLevelingAction(async (req, guild) => {
        const member = await guild.members.fetch(String(req.body.userId || '')).catch(() => null);
        if (!member) throw new Error('Member not found.');
        const result = await rollbackLevelTest(member, {
            adminId: req.dashboardSession.user.id,
            restoreRoles: true,
        });
        if (!result.ok) throw new Error('No active level test session found for that member.');
        return `Rolled back level test session ${result.session.id}.`;
    }));
}

module.exports = {
    registerSettingsRoutes,
};
