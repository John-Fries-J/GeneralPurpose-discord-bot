const { ChannelType } = require('discord.js');

const allowedSections = new Set(['welcome', 'logging', 'tickets', 'joinToCreate', 'leveling', 'moderation', 'music', 'modules']);
const textChannelTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const voiceChannelTypes = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const categoryChannelTypes = new Set([ChannelType.GuildCategory]);

function field(value) {
    return String(value ?? '').trim();
}

function boolField(body, key) {
    return body[key] === 'on' || body[key] === 'true' || body[key] === '1';
}

function intField(body, key, {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
    fallback = 0,
    label = key,
} = {}) {
    const raw = field(body[key]);
    if (raw === '') return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new Error(`${label} must be a whole number.`);
    }
    if (value < min || value > max) {
        throw new Error(`${label} must be between ${min} and ${max}.`);
    }

    return value;
}

function urlField(body, key, {
    label = key,
} = {}) {
    const raw = field(body[key]);
    if (!raw) return '';

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`${label} must be a valid URL.`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${label} must use http or https.`);
    }

    return raw;
}

function moduleKeys(body) {
    return field(body.moduleKeys)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function idMap(items = []) {
    return new Map(items.map(item => [String(item.id), item]));
}

function canBotSend(channel, context) {
    if (!context.enforceSendable) return true;
    if (!channel) return false;
    if (channel.permissionsFor && context.botMember) {
        const permissions = channel.permissionsFor(context.botMember);
        if (permissions?.has) return permissions.has('ViewChannel') && permissions.has('SendMessages');
    }
    return typeof channel.send === 'function' || channel.sendable === true;
}

function validateChannel(context, id, label, allowedTypes, { required = false, requireSendable = false } = {}) {
    const value = field(id);
    if (!value) {
        if (required) throw new Error(`${label} is required.`);
        return value;
    }

    const channel = context.channelMap?.get(value);
    if (!channel) throw new Error(`${label} must be a channel from this server.`);
    if (context.guildId && channel.guildId && channel.guildId !== context.guildId) {
        throw new Error(`${label} must be a channel from this server.`);
    }
    if (allowedTypes && !allowedTypes.has(channel.type)) {
        throw new Error(`${label} has the wrong channel type.`);
    }
    if (requireSendable && !canBotSend(channel, context)) {
        throw new Error(`${label} must be sendable by the bot.`);
    }

    return value;
}

function validateRole(context, id, label, { required = false } = {}) {
    const value = field(id);
    if (!value) {
        if (required) throw new Error(`${label} is required.`);
        return value;
    }

    if (!context.roleMap?.has(value)) {
        throw new Error(`${label} must be a role from this server.`);
    }

    return value;
}

function createValidationContext(options = {}) {
    return {
        allowedModules: new Set(options.allowedModules || []),
        botMember: options.botMember || null,
        channelMap: idMap(options.channels || []),
        enforceSendable: options.enforceSendable === true,
        guildId: options.guildId ? String(options.guildId) : '',
        roleMap: idMap(options.roles || []),
    };
}

function parseDashboardSettings(body = {}, options = {}) {
    const section = field(body.section);
    if (!allowedSections.has(section)) {
        throw new Error('Unsupported dashboard settings section.');
    }
    const context = createValidationContext(options);

    if (section === 'welcome') {
        const enabled = boolField(body, 'welcomeEnabled');
        const channelId = enabled
            ? validateChannel(context, body.welcomeID, 'Welcome channel', textChannelTypes, { required: true, requireSendable: true })
            : '';
        return {
            section,
            message: 'Welcome settings saved',
            values: {
                enabled,
                channelId,
                title: field(body.welcomeTitle),
                description: field(body.welcomeDescription),
                footer: field(body.welcomeFooter),
            },
        };
    }

    if (section === 'logging') {
        const channels = {};
        for (const key of ['logChannel', 'moderation', 'ticket', 'suggestion', 'messageDelete', 'editMessage', 'threadCreate', 'threadDelete', 'threadUpdate', 'directMessage']) {
            channels[key] = validateChannel(context, body[key], `${key} log channel`, textChannelTypes, { requireSendable: true });
        }
        return {
            section,
            message: 'Logging settings saved',
            values: {
                showUserAvatars: boolField(body, 'showUserAvatars'),
                channels,
            },
        };
    }

    if (section === 'tickets') {
        const closeInactivityDays = intField(body, 'closeInactivityDays', {
            min: 0,
            max: 365,
            fallback: 0,
            label: 'Close inactivity days',
        });
        const channelId = validateChannel(context, body.ticketChannelId, 'Ticket panel channel', textChannelTypes, { requireSendable: true });
        const categoryId = validateChannel(context, body.ticketCategoryId, 'Ticket category', categoryChannelTypes);
        const supportRoleId = validateRole(context, body.supportRoleId, 'Support role');
        if (channelId || categoryId || supportRoleId) {
            if (!channelId) throw new Error('Ticket panel channel is required when ticket settings are configured.');
            if (!categoryId) throw new Error('Ticket category is required when ticket settings are configured.');
            if (!supportRoleId) throw new Error('Support role is required when ticket settings are configured.');
        }
        return {
            section,
            message: 'Ticket settings saved',
            values: {
                channelId,
                categoryId,
                supportRoleId,
                allowTranscripts: boolField(body, 'allowTranscripts'),
                allowUserAdding: boolField(body, 'allowUserAdding'),
                allowClaiming: boolField(body, 'allowClaiming'),
                closeInactivityDays,
            },
        };
    }

    if (section === 'joinToCreate') {
        const enabled = boolField(body, 'enabled');
        return {
            section,
            message: 'Temporary voice settings saved',
            values: {
                enabled,
                triggerChannelId: validateChannel(context, body.triggerChannelId, 'Trigger channel', voiceChannelTypes, { required: enabled }),
                categoryId: validateChannel(context, body.categoryId, 'Temporary channel category', categoryChannelTypes),
                nameFormat: field(body.nameFormat) || "{username}'s Channel",
                userLimitMax: intField(body, 'userLimitMax', {
            min: 1,
            max: 99,
            fallback: 25,
            label: 'Maximum users',
                }),
                emptyGraceMs: intField(body, 'emptyGraceSeconds', {
            min: 0,
            max: 3600,
            fallback: 10,
            label: 'Empty grace period seconds',
                }) * 1000,
            },
        };
    }

    if (section === 'leveling') {
        const mode = field(body.mode);
        if (!['text', 'voice', 'both'].includes(mode)) {
            throw new Error('Leveling mode must be text, voice, or both.');
        }
        return {
            section,
            message: 'Leveling settings saved',
            values: {
                enabled: boolField(body, 'enabled'),
                mode,
                textXpPerMessage: intField(body, 'textXpPerMessage', {
                    min: 0,
                    max: 1000,
                    fallback: 1,
                    label: 'Text XP per message',
                }),
                voiceXpPerMinute: intField(body, 'voiceXpPerMinute', {
                    min: 0,
                    max: 1000,
                    fallback: 1,
                    label: 'Voice XP per minute',
                }),
                cooldownSeconds: intField(body, 'cooldownSeconds', {
                    min: 0,
                    max: 86400,
                    fallback: 60,
                    label: 'Text XP cooldown seconds',
                }),
            },
        };
    }

    if (section === 'moderation') {
        return {
            section,
            message: 'Moderation settings saved',
            values: {
                muteRoleId: validateRole(context, body.muteRoleId, 'Mute role'),
                muteRoleName: field(body.muteRoleName) || 'Muted',
                appealUrl: urlField(body, 'appealUrl', { label: 'Appeal URL' }),
            },
        };
    }

    if (section === 'music') {
        return {
            section,
            message: 'Music settings saved',
            values: {
                enabled: boolField(body, 'enabled'),
                maxQueueLength: intField(body, 'maxQueueLength', {
                    min: 1,
                    max: 1000,
                    fallback: 50,
                    label: 'Maximum queue length',
                }),
                allowFileUploads: boolField(body, 'allowFileUploads'),
                voiceReadyTimeoutMs: intField(body, 'voiceReadyTimeoutMs', {
                    min: 5000,
                    max: 300000,
                    fallback: 60000,
                    label: 'Voice ready timeout',
                }),
                voiceJoinRetries: intField(body, 'voiceJoinRetries', {
                    min: 0,
                    max: 10,
                    fallback: 1,
                    label: 'Voice join retries',
                }),
                voiceRetryDelayMs: intField(body, 'voiceRetryDelayMs', {
                    min: 0,
                    max: 60000,
                    fallback: 1000,
                    label: 'Voice retry delay',
                }),
                voiceDebug: boolField(body, 'voiceDebug'),
                ytDlpCookiesPath: field(body.ytDlpCookiesPath),
            },
        };
    }

    const keys = moduleKeys(body);
    if (context.allowedModules.size) {
        const unknownModule = keys.find(key => !context.allowedModules.has(key));
        if (unknownModule) throw new Error('Unknown module setting submitted.');
    }

    const modules = {};
    for (const key of keys) {
        modules[key] = boolField(body, `module:${key}`);
    }
    return { section, message: 'Module settings saved', values: { modules } };
}

function applyDashboardSettings(config, body = {}, options = {}) {
    const result = parseDashboardSettings(body, options);

    if (result.section === 'welcome') {
        config.WelcomeEmbed = config.WelcomeEmbed || {};
        config.welcomeID = result.values.enabled ? result.values.channelId : '';
        config.WelcomeEmbed.title = result.values.title;
        config.WelcomeEmbed.description = result.values.description;
        config.WelcomeEmbed.footer = result.values.footer;
        return { section: result.section, message: result.message };
    }

    if (result.section === 'logging') {
        config.logging = config.logging || {};
        config.logChannels = config.logChannels || {};
        config.logging.showUserAvatars = result.values.showUserAvatars;
        Object.assign(config.logChannels, result.values.channels);
        return { section: result.section, message: result.message };
    }

    if (result.section === 'tickets') {
        config.tickets = { ...(config.tickets || {}), ...result.values };
        return { section: result.section, message: result.message };
    }

    if (result.section === 'joinToCreate') {
        config.joinToCreate = { ...(config.joinToCreate || {}), ...result.values };
        return { section: result.section, message: result.message };
    }

    if (result.section === 'leveling') {
        config.leveling = { ...(config.leveling || {}), ...result.values };
        return { section: result.section, message: result.message };
    }

    if (result.section === 'moderation') {
        config.moderation = { ...(config.moderation || {}), ...result.values };
        return { section: result.section, message: result.message };
    }

    if (result.section === 'music') {
        config.music = { ...(config.music || {}), ...result.values };
        return { section: result.section, message: result.message };
    }

    config.commandSettings = config.commandSettings || {};
    config.commandSettings.modules = config.commandSettings.modules || {};
    Object.assign(config.commandSettings.modules, result.values.modules);
    return { section: result.section, message: result.message };
}

module.exports = {
    applyDashboardSettings,
    boolField,
    createValidationContext,
    intField,
    parseDashboardSettings,
    urlField,
};
