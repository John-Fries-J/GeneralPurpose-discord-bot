const { ChannelType } = require('discord.js');

function renderError(deps, res, client, session, title, heading, message, status = 400) {
    return res.status(status).send(deps.renderLayout(title, `<section class="panel"><h2>${deps.escapeHtml(heading)}</h2><p>${deps.escapeHtml(message)}</p></section>`, session.user, client));
}

function registerContentRoutes(app, client, deps) {
    app.post('/language-section', deps.requireCsrf, (req, res) => {
        try {
            const section = req.body.section;
            const parsed = JSON.parse(req.body.content || '{}');
            deps.assertSafeConfigObject(parsed);
            if (!section || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Language section must be a JSON object.');
            }

            const currentLanguage = deps.language.loadLanguage();
            currentLanguage[section] = parsed;
            deps.language.saveLanguage(currentLanguage);
            deps.appendDashboardLog('Language section saved', { section, userId: req.dashboardSession.user.id });
            res.redirect('/language');
        } catch (error) {
            res.status(400).send(deps.renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${deps.escapeHtml(deps.safeErrorMessage(error, 'Language was not saved.'))}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/language-json', deps.requireCsrf, (req, res) => {
        try {
            const parsed = JSON.parse(req.body.language);
            deps.assertSafeConfigObject(parsed);
            deps.language.saveLanguage(parsed);
            deps.appendDashboardLog('language.json saved from dashboard', { userId: req.dashboardSession.user.id });
            res.redirect('/language?message=language.json%20saved');
        } catch (error) {
            res.status(400).send(deps.renderLayout('Invalid language', `<section class="panel"><h2>Invalid language JSON</h2><p>${deps.escapeHtml(deps.safeErrorMessage(error, 'Language was not saved.'))}</p><p>Use the browser back button and fix the JSON.</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/send-message', deps.requireCsrf, async (req, res) => {
        try {
            const activeGuild = req.dashboardGuild || deps.getDashboardGuild(client);
            const activeGuildId = activeGuild?.id || deps.getDashboardConfig().guildId || deps.getStoredConfig().guildId;
            const needsChannel = req.body.saveTemplate !== '1';
            const channel = needsChannel
                ? await deps.resolveDashboardChannel(activeGuild, req.body.channelId, {
                    label: 'Message channel',
                    types: [ChannelType.GuildAnnouncement, ChannelType.GuildText],
                    requireSendable: true,
                })
                : null;
            const selectedTemplate = req.body.templateId
                ? (await deps.listEmbedTemplates(activeGuildId)).find(item => item.id === req.body.templateId)
                : null;
            const payload = selectedTemplate && !req.body.content && !req.body.embedTitle && !req.body.embedDescription
                ? {
                    content: selectedTemplate.content,
                    embed: selectedTemplate.embed,
                    embeds: selectedTemplate.embed ? [deps.buildEmbedFromTemplate(selectedTemplate.embed)] : undefined,
                }
                : deps.buildDashboardMessagePayload(req.body);
            if (!payload.content && !payload.embeds) {
                return renderError(deps, res, client, req.dashboardSession, 'Message not sent', 'Message not sent', 'Add message content or embed text before sending.');
            }

            if (req.body.saveTemplate === '1') {
                const templateName = String(req.body.templateName || '').trim();
                if (!templateName) {
                    return renderError(deps, res, client, req.dashboardSession, 'Template not saved', 'Template not saved', 'Add a template name before saving.');
                }

                await deps.upsertEmbedTemplate({
                    guildId: activeGuildId,
                    name: templateName,
                    content: payload.content || '',
                    embed: payload.embed || null,
                    updatedBy: req.dashboardSession.user.id,
                });
                deps.appendDashboardLog('Embed template saved', { name: templateName, userId: req.dashboardSession.user.id });
                return res.redirect('/sender?message=Template%20saved');
            }

            const scheduleAt = String(req.body.scheduleAt || '').trim();
            if (scheduleAt) {
                const scheduledFor = Date.parse(scheduleAt);
                if (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now()) {
                    return renderError(deps, res, client, req.dashboardSession, 'Message not scheduled', 'Message not scheduled', 'Choose a future date and time.');
                }

                await deps.createScheduledMessage({
                    guildId: activeGuildId,
                    channelId: channel.id,
                    content: payload.content || '',
                    embed: payload.embed || null,
                    createdBy: req.dashboardSession.user.id,
                    scheduledFor,
                });
                deps.appendDashboardLog('Dashboard message scheduled', { channelId: channel.id, userId: req.dashboardSession.user.id, scheduledFor });
                return res.redirect('/sender?message=Message%20scheduled');
            }

            const sendPayload = {};
            if (payload.content) sendPayload.content = payload.content;
            if (payload.embeds) sendPayload.embeds = payload.embeds;
            await channel.send(sendPayload);
            deps.appendDashboardLog('Dashboard message sent', { channelId: channel.id, userId: req.dashboardSession.user.id });
            return res.redirect('/sender?message=Message%20sent');
        } catch (error) {
            console.error('Dashboard message send failed:', error);
            const redactedMessage = deps.safeErrorMessage(error);
            const safeMessage = /channel|template|message content|future date/i.test(redactedMessage)
                ? redactedMessage
                : 'Discord rejected the message. Check the bot permissions and message content.';
            res.status(/channel|template|message content|future date/i.test(redactedMessage) ? 400 : 500)
                .send(deps.renderLayout('Message failed', `<section class="panel"><h2>Message failed</h2><p>${deps.escapeHtml(safeMessage)}</p></section>`, req.dashboardSession.user, client));
        }
    });

    app.post('/embed-template/delete', deps.requireCsrf, async (req, res) => {
        const activeGuildId = req.dashboardGuild?.id || deps.getDashboardConfig().guildId || deps.getStoredConfig().guildId;
        const template = (await deps.listEmbedTemplates(activeGuildId)).find(item => item.id === req.body.id);
        if (!template) {
            return renderError(deps, res, client, req.dashboardSession, 'Template not found', 'Template not found', 'That template is not available for this server.', 404);
        }
        await deps.deleteEmbedTemplate(activeGuildId, req.body.id);
        deps.appendDashboardLog('Embed template deleted', { id: req.body.id, userId: req.dashboardSession.user.id });
        res.redirect('/sender?message=Template%20deleted');
    });
}

module.exports = {
    registerContentRoutes,
};
