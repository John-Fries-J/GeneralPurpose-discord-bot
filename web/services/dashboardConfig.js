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

function applyDashboardSettings(config, body = {}, options = {}) {
    const section = field(body.section);
    if (!allowedSections.has(section)) {
        throw new Error('Unsupported dashboard settings section.');
    }
    const context = createValidationContext(options);

    if (section === 'welcome') {
        config.WelcomeEmbed = config.WelcomeEmbed || {};
        const enabled = boolField(body, 'welcomeEnabled');
        config.welcomeID = enabled
            ? validateChannel(context, body.welcomeID, 'Welcome channel', textChannelTypes, { required: true })
            : '';
        config.WelcomeEmbed.title = field(body.welcomeTitle);
        config.WelcomeEmbed.description = field(body.welcomeDescription);
        config.WelcomeEmbed.footer = field(body.welcomeFooter);
        return { section, message: 'Welcome settings saved' };
    }

    if (section === 'logging') {
        config.logging = config.logging || {};
        config.logChannels = config.logChannels || {};
        config.logging.showUserAvatars = boolField(body, 'showUserAvatars');
        for (const key of ['logChannel', 'moderation', 'ticket', 'suggestion', 'messageDelete', 'editMessage', 'threadCreate', 'threadDelete', 'threadUpdate', 'directMessage']) {
            config.logChannels[key] = validateChannel(context, body[key], `${key} log channel`, textChannelTypes);
        }
        return { section, message: 'Logging settings saved' };
    }

    if (section === 'tickets') {
        config.tickets = config.tickets || {};
        config.tickets.channelId = validateChannel(context, body.ticketChannelId, 'Ticket panel channel', textChannelTypes);
        config.tickets.categoryId = validateChannel(context, body.ticketCategoryId, 'Ticket category', categoryChannelTypes);
        config.tickets.supportRoleId = validateRole(context, body.supportRoleId, 'Support role');
        config.tickets.allowTranscripts = boolField(body, 'allowTranscripts');
        config.tickets.allowUserAdding = boolField(body, 'allowUserAdding');
        config.tickets.allowClaiming = boolField(body, 'allowClaiming');
        config.tickets.closeInactivityDays = intField(body, 'closeInactivityDays', {
            min: 0,
            max: 365,
            fallback: 0,
            label: 'Close inactivity days',
        });
        return { section, message: 'Ticket settings saved' };
    }

    if (section === 'joinToCreate') {
        config.joinToCreate = config.joinToCreate || {};
        config.joinToCreate.enabled = boolField(body, 'enabled');
        config.joinToCreate.triggerChannelId = validateChannel(context, body.triggerChannelId, 'Trigger channel', voiceChannelTypes, { required: config.joinToCreate.enabled });
        config.joinToCreate.categoryId = validateChannel(context, body.categoryId, 'Temporary channel category', categoryChannelTypes);
        config.joinToCreate.nameFormat = field(body.nameFormat) || "{username}'s Channel";
        config.joinToCreate.userLimitMax = intField(body, 'userLimitMax', {
            min: 1,
            max: 99,
            fallback: 25,
            label: 'Maximum users',
        });
        config.joinToCreate.emptyGraceMs = intField(body, 'emptyGraceSeconds', {
            min: 0,
            max: 3600,
            fallback: 10,
            label: 'Empty grace period seconds',
        }) * 1000;
        return { section, message: 'Temporary voice settings saved' };
    }

    if (section === 'leveling') {
        config.leveling = config.leveling || {};
        config.leveling.enabled = boolField(body, 'enabled');
        const mode = field(body.mode);
        if (!['text', 'voice', 'both'].includes(mode)) {
            throw new Error('Leveling mode must be text, voice, or both.');
        }
        config.leveling.mode = mode;
        config.leveling.textXpPerMessage = intField(body, 'textXpPerMessage', {
            min: 0,
            max: 1000,
            fallback: 1,
            label: 'Text XP per message',
        });
        config.leveling.voiceXpPerMinute = intField(body, 'voiceXpPerMinute', {
            min: 0,
            max: 1000,
            fallback: 1,
            label: 'Voice XP per minute',
        });
        config.leveling.cooldownSeconds = intField(body, 'cooldownSeconds', {
            min: 0,
            max: 86400,
            fallback: 60,
            label: 'Text XP cooldown seconds',
        });
        return { section, message: 'Leveling settings saved' };
    }

    const keys = moduleKeys(body);
    if (context.allowedModules.size) {
        const unknownModule = keys.find(key => !context.allowedModules.has(key));
        if (unknownModule) throw new Error('Unknown module setting submitted.');
    }

    config.commandSettings = config.commandSettings || {};
    config.commandSettings.modules = config.commandSettings.modules || {};
    for (const key of keys) {
        config.commandSettings.modules[key] = boolField(body, `module:${key}`);
    }
    return { section, message: 'Module settings saved' };
}

module.exports = {
    applyDashboardSettings,
    boolField,
    createValidationContext,
    intField,
};
