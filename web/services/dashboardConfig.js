const { ChannelType } = require('discord.js');

const allowedSections = new Set(['welcome', 'logging', 'tickets', 'joinToCreate', 'leveling', 'modules']);
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

function moduleKeys(body) {
    return field(body.moduleKeys)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function idMap(items = []) {
    return new Map(items.map(item => [String(item.id), item]));
}

function validateChannel(context, id, label, allowedTypes, { required = false } = {}) {
    const value = field(id);
    if (!value) {
        if (required) throw new Error(`${label} is required.`);
        return value;
    }

    const channel = context.channelMap?.get(value);
    if (!channel) throw new Error(`${label} must be a channel from this server.`);
    if (allowedTypes && !allowedTypes.has(channel.type)) {
        throw new Error(`${label} has the wrong channel type.`);
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
        channelMap: idMap(options.channels || []),
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
            ? validateChannel(context, body.welcomeID, 'Welcome channel', textChannelTypes, { required: true })
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
            channels[key] = validateChannel(context, body[key], `${key} log channel`, textChannelTypes);
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
        return {
            section,
            message: 'Ticket settings saved',
            values: {
                channelId: validateChannel(context, body.ticketChannelId, 'Ticket panel channel', textChannelTypes),
                categoryId: validateChannel(context, body.ticketCategoryId, 'Ticket category', categoryChannelTypes),
                supportRoleId: validateRole(context, body.supportRoleId, 'Support role'),
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
};
