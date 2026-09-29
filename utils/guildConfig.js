const { getConfig } = require('./config');
const { redactSensitiveConfig } = require('./redaction');
const {
    getGuildConfigurationOverrides,
    listConfigAudit,
    saveGuildConfigurationSection,
} = require('./store');

const cacheTtlMs = 30_000;
const cache = new Map();

const logChannelKeys = [
    'logChannel',
    'moderation',
    'ticket',
    'suggestion',
    'messageDelete',
    'editMessage',
    'threadCreate',
    'threadDelete',
    'threadUpdate',
    'directMessage',
    'dmLog',
];

const allowedSources = new Set(['dashboard', 'discord_setup', 'command', 'system']);

const builtInSections = Object.freeze({
    welcome: Object.freeze({
        enabled: false,
        channelId: '',
        title: 'Welcome',
        description: 'Welcome {user} to {server}.',
        footer: '',
    }),
    logging: Object.freeze({
        showUserAvatars: true,
    }),
    logChannels: Object.freeze(Object.fromEntries(logChannelKeys.map(key => [key, '']))),
    tickets: Object.freeze({
        channelId: '',
        messageId: '',
        categoryId: '',
        supportRoleId: '',
        allowTranscripts: true,
        allowUserAdding: true,
        allowClaiming: true,
        closeInactivityDays: 0,
        autoCloseDays: 0,
    }),
    joinToCreate: Object.freeze({
        enabled: false,
        triggerChannelId: '',
        categoryId: '',
        nameFormat: "{username}'s Channel",
        userLimitMax: 25,
        emptyGraceMs: 10_000,
    }),
    leveling: Object.freeze({
        enabled: false,
        mode: 'text',
        textXpPerMessage: 1,
        voiceXpPerMinute: 1,
        cooldownSeconds: 60,
        roleRewards: [],
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        roleMultipliers: [],
        channelMultipliers: [],
        xpPerLevelBase: 100,
    }),
});

const sectionKeys = {
    welcome: new Set(['enabled', 'channelId', 'title', 'description', 'footer']),
    logging: new Set(['showUserAvatars']),
    tickets: new Set(['channelId', 'messageId', 'categoryId', 'supportRoleId', 'allowTranscripts', 'allowUserAdding', 'allowClaiming', 'closeInactivityDays', 'autoCloseDays']),
    joinToCreate: new Set(['enabled', 'triggerChannelId', 'categoryId', 'nameFormat', 'userLimitMax', 'emptyGraceMs']),
    leveling: new Set(['enabled', 'mode', 'textXpPerMessage', 'voiceXpPerMinute', 'cooldownSeconds', 'roleRewards', 'ignoredChannelIds', 'ignoredRoleIds', 'roleMultipliers', 'channelMultipliers', 'xpPerLevelBase']),
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function firstDefined(...values) {
    return values.find(value => value !== undefined);
}

function asString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function asBoolean(value, fallback = false) {
    return value === undefined ? fallback : value === true;
}

function asNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function asArray(value, fallback = []) {
    return Array.isArray(value) ? value : fallback;
}

function baseSections() {
    return {
        welcome: clone(builtInSections.welcome),
        logging: clone(builtInSections.logging),
        logChannels: clone(builtInSections.logChannels),
        tickets: clone(builtInSections.tickets),
        joinToCreate: clone(builtInSections.joinToCreate),
        leveling: clone(builtInSections.leveling),
    };
}

function applyGlobalConfig(sections, config = getConfig()) {
    const welcomeEmbed = config.WelcomeEmbed || {};
    if (hasOwn(config, 'welcomeID')) {
        sections.welcome.enabled = Boolean(config.welcomeID);
        sections.welcome.channelId = asString(config.welcomeID);
    }
    if (hasOwn(welcomeEmbed, 'title')) sections.welcome.title = asString(welcomeEmbed.title, sections.welcome.title);
    if (hasOwn(welcomeEmbed, 'description')) sections.welcome.description = asString(welcomeEmbed.description, sections.welcome.description);
    if (hasOwn(welcomeEmbed, 'footer')) sections.welcome.footer = asString(welcomeEmbed.footer, sections.welcome.footer);

    const logging = config.logging || {};
    if (hasOwn(logging, 'showUserAvatars')) {
        sections.logging.showUserAvatars = logging.showUserAvatars !== false;
    }
    for (const key of logChannelKeys) {
        if (hasOwn(config.logChannels, key)) sections.logChannels[key] = asString(config.logChannels[key]);
    }

    const tickets = config.tickets || {};
    sections.tickets.channelId = asString(firstDefined(tickets.channelId, config.ticketChannelId), sections.tickets.channelId);
    sections.tickets.messageId = asString(firstDefined(tickets.messageId, config.ticketMessageID), sections.tickets.messageId);
    sections.tickets.categoryId = asString(firstDefined(tickets.categoryId, config.ticketCategoryId), sections.tickets.categoryId);
    sections.tickets.supportRoleId = asString(firstDefined(tickets.supportRoleId, config.ticketRole), sections.tickets.supportRoleId);
    sections.tickets.allowTranscripts = asBoolean(tickets.allowTranscripts, sections.tickets.allowTranscripts);
    sections.tickets.allowUserAdding = asBoolean(tickets.allowUserAdding, sections.tickets.allowUserAdding);
    sections.tickets.allowClaiming = asBoolean(tickets.allowClaiming, sections.tickets.allowClaiming);
    sections.tickets.closeInactivityDays = asNumber(firstDefined(tickets.closeInactivityDays, tickets.autoCloseDays), sections.tickets.closeInactivityDays);
    sections.tickets.autoCloseDays = asNumber(firstDefined(tickets.autoCloseDays, tickets.closeInactivityDays), sections.tickets.autoCloseDays);

    const voice = config.joinToCreate || {};
    sections.joinToCreate.enabled = asBoolean(voice.enabled, sections.joinToCreate.enabled);
    sections.joinToCreate.triggerChannelId = asString(voice.triggerChannelId, sections.joinToCreate.triggerChannelId);
    sections.joinToCreate.categoryId = asString(voice.categoryId, sections.joinToCreate.categoryId);
    sections.joinToCreate.nameFormat = asString(voice.nameFormat, sections.joinToCreate.nameFormat);
    sections.joinToCreate.userLimitMax = asNumber(voice.userLimitMax, sections.joinToCreate.userLimitMax);
    sections.joinToCreate.emptyGraceMs = asNumber(voice.emptyGraceMs, sections.joinToCreate.emptyGraceMs);

    const leveling = config.leveling || {};
    sections.leveling.enabled = asBoolean(leveling.enabled, sections.leveling.enabled);
    sections.leveling.mode = ['text', 'voice', 'both'].includes(leveling.mode) ? leveling.mode : sections.leveling.mode;
    sections.leveling.textXpPerMessage = asNumber(leveling.textXpPerMessage, sections.leveling.textXpPerMessage);
    sections.leveling.voiceXpPerMinute = asNumber(leveling.voiceXpPerMinute, sections.leveling.voiceXpPerMinute);
    sections.leveling.cooldownSeconds = asNumber(leveling.cooldownSeconds, sections.leveling.cooldownSeconds);
    sections.leveling.roleRewards = asArray(leveling.roleRewards, sections.leveling.roleRewards);
    sections.leveling.ignoredChannelIds = asArray(leveling.ignoredChannelIds, sections.leveling.ignoredChannelIds);
    sections.leveling.ignoredRoleIds = asArray(leveling.ignoredRoleIds, sections.leveling.ignoredRoleIds);
    sections.leveling.roleMultipliers = asArray(leveling.roleMultipliers, sections.leveling.roleMultipliers);
    sections.leveling.channelMultipliers = asArray(leveling.channelMultipliers, sections.leveling.channelMultipliers);
    sections.leveling.xpPerLevelBase = asNumber(leveling.xpPerLevelBase, sections.leveling.xpPerLevelBase);

    return sections;
}

function applyGuildOverrides(sections, overrides = {}) {
    let hasRoleRewardsOverride = false;

    for (const row of overrides.settings || []) {
        const section = row.section;
        const key = row.key;
        if (!sectionKeys[section]?.has(key)) continue;

        if (section === 'welcome') sections.welcome[key] = row.value;
        if (section === 'logging') sections.logging[key] = row.value;
        if (section === 'tickets') sections.tickets[key] = row.value;
        if (section === 'joinToCreate') sections.joinToCreate[key] = row.value;
        if (section === 'leveling') {
            sections.leveling[key] = row.value;
            if (key === 'roleRewards') hasRoleRewardsOverride = true;
        }
    }

    for (const row of overrides.logChannels || []) {
        if (logChannelKeys.includes(row.key)) sections.logChannels[row.key] = row.channelId ?? '';
    }

    if (!hasRoleRewardsOverride && overrides.levelRewards?.length) {
        sections.leveling.roleRewards = overrides.levelRewards
            .map(reward => ({ xp: Number(reward.xp || 0), roleId: reward.roleId }))
            .filter(reward => reward.roleId)
            .sort((a, b) => a.xp - b.xp);
    }

    sections.tickets.autoCloseDays = asNumber(firstDefined(sections.tickets.autoCloseDays, sections.tickets.closeInactivityDays), 0);
    return sections;
}

function toConfigShape(sections) {
    return {
        welcome: clone(sections.welcome),
        welcomeID: sections.welcome.enabled ? sections.welcome.channelId : '',
        WelcomeEmbed: {
            title: sections.welcome.title,
            description: sections.welcome.description,
            footer: sections.welcome.footer,
        },
        logging: clone(sections.logging),
        logChannels: clone(sections.logChannels),
        tickets: clone(sections.tickets),
        joinToCreate: clone(sections.joinToCreate),
        leveling: clone(sections.leveling),
    };
}

async function loadGuildSettings(guildId) {
    const sections = applyGlobalConfig(baseSections());
    if (guildId) {
        applyGuildOverrides(sections, await getGuildConfigurationOverrides(guildId));
    }
    return toConfigShape(sections);
}

async function getGuildSettings(guildId) {
    const key = String(guildId || '');
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return clone(cached.value);

    const value = await loadGuildSettings(key);
    cache.set(key, { value: clone(value), expiresAt: Date.now() + cacheTtlMs });
    return clone(value);
}

async function getGuildSetting(guildId, section, key) {
    const settings = await getGuildSettings(guildId);
    if (section === 'logging' && logChannelKeys.includes(key)) return settings.logChannels[key];
    if (section === 'welcome') return settings.welcome?.[key];
    return settings[section]?.[key];
}

function invalidateGuildSettings(guildId) {
    cache.delete(String(guildId || ''));
}

function resetGuildSettingsCache() {
    cache.clear();
}

function normalizeLevelRewards(rewards = []) {
    return rewards
        .map(reward => ({ xp: Math.max(0, Number(reward.xp || 0)), roleId: asString(reward.roleId) }))
        .filter(reward => reward.roleId)
        .sort((a, b) => a.xp - b.xp || a.roleId.localeCompare(b.roleId));
}

function normalizeGuildSettings(section, values = {}) {
    if (!sectionKeys[section]) throw new Error('Unsupported guild settings section.');
    const allowedInputKeys = new Set(sectionKeys[section]);
    if (section === 'logging') {
        allowedInputKeys.add('channels');
        allowedInputKeys.add('logChannels');
    }
    const unknownKey = Object.keys(values).find(key => !allowedInputKeys.has(key));
    if (unknownKey) throw new Error(`Unsupported ${section} setting.`);

    const settings = {};
    const logChannels = {};
    let levelRewards;

    const assign = (key, value) => {
        if (!sectionKeys[section].has(key)) throw new Error(`Unsupported ${section} setting.`);
        settings[key] = value;
    };

    if (section === 'welcome') {
        if (hasOwn(values, 'enabled')) assign('enabled', values.enabled === true);
        if (hasOwn(values, 'channelId')) assign('channelId', asString(values.channelId).trim());
        if (hasOwn(values, 'title')) assign('title', asString(values.title).trim());
        if (hasOwn(values, 'description')) assign('description', asString(values.description).trim());
        if (hasOwn(values, 'footer')) assign('footer', asString(values.footer).trim());
    }

    if (section === 'logging') {
        if (hasOwn(values, 'showUserAvatars')) assign('showUserAvatars', values.showUserAvatars !== false);
        const channels = values.channels || values.logChannels || {};
        for (const [key, channelId] of Object.entries(channels)) {
            if (!logChannelKeys.includes(key)) throw new Error('Unsupported logging channel setting.');
            logChannels[key] = asString(channelId).trim();
        }
    }

    if (section === 'tickets') {
        for (const key of sectionKeys.tickets) {
            if (!hasOwn(values, key)) continue;
            if (['allowTranscripts', 'allowUserAdding', 'allowClaiming'].includes(key)) {
                assign(key, values[key] === true);
            } else if (['closeInactivityDays', 'autoCloseDays'].includes(key)) {
                assign(key, Math.max(0, Number(values[key] || 0)));
            } else {
                assign(key, asString(values[key]).trim());
            }
        }
        if (hasOwn(settings, 'closeInactivityDays') && !hasOwn(settings, 'autoCloseDays')) {
            settings.autoCloseDays = settings.closeInactivityDays;
        }
    }

    if (section === 'joinToCreate') {
        for (const key of sectionKeys.joinToCreate) {
            if (!hasOwn(values, key)) continue;
            if (key === 'enabled') assign(key, values[key] === true);
            else if (['userLimitMax', 'emptyGraceMs'].includes(key)) assign(key, Number(values[key] || 0));
            else assign(key, asString(values[key]).trim());
        }
    }

    if (section === 'leveling') {
        for (const key of sectionKeys.leveling) {
            if (!hasOwn(values, key)) continue;
            if (key === 'enabled') assign(key, values[key] === true);
            else if (key === 'mode') {
                if (!['text', 'voice', 'both'].includes(values[key])) throw new Error('Leveling mode must be text, voice, or both.');
                assign(key, values[key]);
            } else if (key === 'roleRewards') {
                levelRewards = normalizeLevelRewards(values[key]);
                assign(key, levelRewards);
            } else if (['ignoredChannelIds', 'ignoredRoleIds', 'roleMultipliers', 'channelMultipliers'].includes(key)) {
                assign(key, asArray(values[key], []));
            } else {
                assign(key, Number(values[key] || 0));
            }
        }
    }

    return { settings, logChannels, levelRewards };
}

function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function redactAuditValue(value, key = '') {
    return redactSensitiveConfig(value, key);
}

function safeAuditValue(value, key = '') {
    const json = JSON.stringify(redactAuditValue(value, key));
    if (json.length <= 300) return json;
    return `${json.slice(0, 297)}...`;
}

function buildAuditEntries(guildId, before, section, normalized, metadata = {}) {
    const source = allowedSources.has(metadata.source) ? metadata.source : 'command';
    const createdAt = metadata.createdAt || Date.now();
    const entries = [];
    const push = (key, previousValue, newValue) => {
        if (valuesEqual(previousValue, newValue)) return;
        entries.push({
            guildId,
            actorId: metadata.actorId || null,
            section,
            key,
            previousValue: safeAuditValue(previousValue, key),
            newValue: safeAuditValue(newValue, key),
            source,
            createdAt,
        });
    };

    for (const [key, value] of Object.entries(normalized.settings || {})) {
        const previous = section === 'welcome' ? before.welcome[key] : before[section]?.[key];
        push(key, previous, value);
    }

    for (const [key, value] of Object.entries(normalized.logChannels || {})) {
        push(key, before.logChannels?.[key] ?? '', value);
    }

    if (normalized.levelRewards) {
        push('roleRewards', before.leveling?.roleRewards || [], normalized.levelRewards);
    }

    return entries;
}

async function updateGuildSettings(guildId, section, values = {}, metadata = {}) {
    if (!guildId) throw new Error('Guild ID is required.');
    const before = await getGuildSettings(guildId);
    const normalized = normalizeGuildSettings(section, values);
    const auditEntries = buildAuditEntries(guildId, before, section, normalized, metadata);

    await saveGuildConfigurationSection(guildId, section, {
        settings: normalized.settings,
        logChannels: Object.keys(normalized.logChannels).length ? normalized.logChannels : null,
        levelRewards: normalized.levelRewards,
        auditEntries,
    }, {
        actorId: metadata.actorId || null,
        updatedAt: metadata.updatedAt || Date.now(),
    });

    invalidateGuildSettings(guildId);
    return {
        auditEntries,
        settings: await getGuildSettings(guildId),
    };
}

function updateWelcomeSettings(guildId, values, metadata) {
    return updateGuildSettings(guildId, 'welcome', values, metadata);
}

function updateLoggingSettings(guildId, values, metadata) {
    return updateGuildSettings(guildId, 'logging', values, metadata);
}

function updateTicketSettings(guildId, values, metadata) {
    return updateGuildSettings(guildId, 'tickets', values, metadata);
}

function updateJoinToCreateSettings(guildId, values, metadata) {
    return updateGuildSettings(guildId, 'joinToCreate', values, metadata);
}

function updateLevelingSettings(guildId, values, metadata) {
    return updateGuildSettings(guildId, 'leveling', values, metadata);
}

module.exports = {
    builtInSections,
    getGuildSetting,
    getGuildSettings,
    invalidateGuildSettings,
    listConfigAudit,
    logChannelKeys,
    resetGuildSettingsCache,
    updateGuildSettings,
    updateJoinToCreateSettings,
    updateLevelingSettings,
    updateLoggingSettings,
    updateTicketSettings,
    updateWelcomeSettings,
};
