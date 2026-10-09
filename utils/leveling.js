const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { getGuildSettings } = require('./guildConfig');
const {
    addUserXp,
    adjustUserXp,
    getLevelRank,
    getUserLevelRecord,
    listLevelLeaderboard,
    setUserXp,
    setUserXpMinimum,
} = require('./store');

const supportedFormulas = new Set(['legacy', 'linear', 'quadratic', 'exponential', 'probot_inspired']);
const supportedProfiles = new Set(['legacy', 'probot_inspired', 'custom']);
const recentTextActivity = new Map();
const voiceAwardState = new Map();

function number(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function integer(value, fallback, bounds = {}) {
    return Math.floor(number(value, fallback, bounds));
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function object(value, fallback = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function bool(value, fallback = false) {
    return value === undefined ? fallback : value === true;
}

function getProfileDefaults(profile = 'legacy') {
    if (profile === 'probot_inspired') {
        return {
            textXpMin: 15,
            textXpMax: 25,
            cooldownSeconds: 60,
            progressionFormula: 'probot_inspired',
            xpPerLevelBase: 100,
        };
    }

    return {
        textXpMin: 1,
        textXpMax: 1,
        cooldownSeconds: 60,
        progressionFormula: 'legacy',
        xpPerLevelBase: 100,
    };
}

function normalizeRoleRewards(rewards = []) {
    return array(rewards)
        .map(reward => ({
            roleId: reward?.roleId ? String(reward.roleId) : '',
            xp: Math.max(0, integer(reward?.xp, 0)),
            level: reward?.level === undefined ? null : Math.max(0, integer(reward.level, 0)),
        }))
        .filter(reward => reward.roleId)
        .sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0) || a.xp - b.xp || a.roleId.localeCompare(b.roleId));
}

function getLevelingConfig(config = getConfig()) {
    const raw = object(config.leveling);
    const xpProfile = supportedProfiles.has(raw.xpProfile) ? raw.xpProfile : 'legacy';
    const profileDefaults = getProfileDefaults(xpProfile);
    const legacyTextXp = integer(raw.textXpPerMessage, profileDefaults.textXpMin, { min: 0, max: 1000 });
    const textXpMin = integer(raw.textXpMin ?? raw.textXpPerMessage, profileDefaults.textXpMin, { min: 0, max: 1000 });
    const textXpMax = integer(raw.textXpMax ?? raw.textXpPerMessage, profileDefaults.textXpMax, { min: 0, max: 1000 });
    const minTextXp = Math.min(textXpMin, textXpMax);
    const maxTextXp = Math.max(textXpMin, textXpMax);
    const progressionFormula = supportedFormulas.has(raw.progressionFormula)
        ? raw.progressionFormula
        : profileDefaults.progressionFormula;
    const antiFarm = object(raw.antiFarm);
    const voiceEligibility = object(raw.voiceEligibility);
    const roleSync = object(raw.roleSync);
    const rankCard = object(raw.rankCard);

    return {
        enabled: raw.enabled === true,
        mode: ['text', 'voice', 'both'].includes(raw.mode) ? raw.mode : 'text',
        textXpPerMessage: legacyTextXp,
        textXpMin: minTextXp,
        textXpMax: maxTextXp,
        voiceXpPerMinute: integer(raw.voiceXpPerMinute, 1, { min: 0, max: 1000 }),
        cooldownSeconds: integer(raw.cooldownSeconds, profileDefaults.cooldownSeconds, { min: 0, max: 86400 }),
        progressionFormula,
        xpProfile,
        roleRewards: normalizeRoleRewards(raw.roleRewards),
        ignoredChannelIds: array(raw.ignoredChannelIds).map(String),
        ignoredRoleIds: array(raw.ignoredRoleIds).map(String),
        ignoredUserIds: array(raw.ignoredUserIds).map(String),
        roleMultipliers: array(raw.roleMultipliers),
        channelMultipliers: array(raw.channelMultipliers),
        xpPerLevelBase: integer(raw.xpPerLevelBase, profileDefaults.xpPerLevelBase, { min: 1, max: 1_000_000 }),
        xpCurveFactor: number(raw.xpCurveFactor, 1.18, { min: 1.01, max: 10 }),
        announceLevelUp: raw.announceLevelUp === true,
        announceLevelDown: raw.announceLevelDown === true,
        announceChannelId: raw.announceChannelId ? String(raw.announceChannelId) : '',
        levelUpMessage: String(raw.levelUpMessage || '{user} reached level {level}.'),
        levelDownMessage: String(raw.levelDownMessage || '{user} dropped to level {level}.'),
        antiFarm: {
            enabled: antiFarm.enabled === true,
            minMessageLength: integer(antiFarm.minMessageLength, 0, { min: 0, max: 2000 }),
            repeatedMessageWindowSeconds: integer(antiFarm.repeatedMessageWindowSeconds, 300, { min: 0, max: 86400 }),
            maxMessagesPerWindow: integer(antiFarm.maxMessagesPerWindow, 0, { min: 0, max: 1000 }),
            windowSeconds: integer(antiFarm.windowSeconds, 60, { min: 1, max: 86400 }),
        },
        voiceEligibility: {
            allowAfk: bool(voiceEligibility.allowAfk, true),
            allowDeafened: bool(voiceEligibility.allowDeafened, true),
            allowSolo: bool(voiceEligibility.allowSolo, true),
        },
        roleSync: {
            enabled: bool(roleSync.enabled, true),
            awardMissingRoles: bool(roleSync.awardMissingRoles, true),
            removeObsoleteRoles: bool(roleSync.removeObsoleteRoles, false),
            applyDuringMigration: bool(roleSync.applyDuringMigration, false),
            dryRun: bool(roleSync.dryRun, false),
            syncOnLevelUp: bool(roleSync.syncOnLevelUp, true),
        },
        rankCard: {
            enabled: bool(rankCard.enabled, true),
            theme: String(rankCard.theme || 'blue'),
            backgroundUrl: String(rankCard.backgroundUrl || ''),
            leaderboardBackgroundUrl: String(rankCard.leaderboardBackgroundUrl || ''),
        },
    };
}

async function getGuildLevelingConfig(guildId) {
    return getLevelingConfig(await getGuildSettings(guildId));
}

function allowsTextXp(settings) {
    return settings.enabled && ['text', 'both'].includes(settings.mode);
}

function allowsVoiceXp(settings) {
    return settings.enabled && ['voice', 'both'].includes(settings.mode);
}

function getTotalXp(record) {
    return Number(record?.textXp || 0) + Number(record?.voiceXp || 0);
}

function getXpNeededForNextLevel(level, settings = getLevelingConfig()) {
    const currentLevel = Math.max(0, integer(level, 0));
    const nextLevel = currentLevel + 1;
    const base = Math.max(1, integer(settings.xpPerLevelBase, 100));
    const formula = supportedFormulas.has(settings.progressionFormula) ? settings.progressionFormula : 'legacy';

    if (formula === 'linear') return base;
    if (formula === 'quadratic') return Math.floor(base * nextLevel * nextLevel);
    if (formula === 'exponential') return Math.floor(base * Math.pow(number(settings.xpCurveFactor, 1.18, { min: 1.01, max: 10 }), currentLevel));
    if (formula === 'probot_inspired') return Math.floor((5 * nextLevel * nextLevel) + (50 * nextLevel) + base);
    return base * nextLevel;
}

function getXpForLevel(level, settings = getLevelingConfig()) {
    const safeLevel = Math.max(0, integer(level, 0));
    const base = Math.max(1, integer(settings.xpPerLevelBase, 100));
    const formula = supportedFormulas.has(settings.progressionFormula) ? settings.progressionFormula : 'legacy';

    if (formula === 'legacy') {
        return Math.floor((base * safeLevel * (safeLevel + 1)) / 2);
    }

    let total = 0;
    for (let current = 0; current < safeLevel; current += 1) {
        total += getXpNeededForNextLevel(current, settings);
    }
    return total;
}

function getLevelProgress(record, settings = getLevelingConfig()) {
    const totalXp = getTotalXp(record);
    let level = 0;

    while (level < 10000 && totalXp >= getXpForLevel(level + 1, settings)) {
        level += 1;
    }

    const currentLevelXp = getXpForLevel(level, settings);
    const nextLevelXp = getXpForLevel(level + 1, settings);
    const progressXp = totalXp - currentLevelXp;
    const neededXp = nextLevelXp - currentLevelXp;

    return {
        level,
        totalXp,
        currentLevelXp,
        nextLevelXp,
        progressXp,
        neededXp,
        percent: neededXp > 0 ? progressXp / neededXp : 1,
    };
}

function previewFormulaImpact(settings = getLevelingConfig(), levels = [5, 10, 20, 30, 50]) {
    return levels.map(level => ({
        level,
        xp: getXpForLevel(level, settings),
    }));
}

function formatProgressBar(percent, size = 20) {
    const safePercent = Math.max(0, Math.min(1, Number(percent) || 0));
    const filled = Math.round(safePercent * size);
    return `[${'#'.repeat(filled)}${'-'.repeat(size - filled)}]`;
}

function formatXp(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashProfile(profile) {
    return crypto.createHash('sha256').update(stableJson(profile)).digest('hex').slice(0, 16);
}

function historicalProfileFromSettings(settings) {
    return {
        textXpMin: settings.textXpMin,
        textXpMax: settings.textXpMax,
        cooldownSeconds: settings.cooldownSeconds,
        progressionFormula: settings.progressionFormula,
        xpPerLevelBase: settings.xpPerLevelBase,
        xpCurveFactor: settings.xpCurveFactor,
        xpProfile: settings.xpProfile,
    };
}

function deterministicHistoricalXp(guildId, messageId, profile) {
    const min = integer(profile.textXpMin, integer(profile.textXpPerMessage, 1), { min: 0, max: 1000 });
    const max = integer(profile.textXpMax, integer(profile.textXpPerMessage, min), { min: 0, max: 1000 });
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    if (high <= low) return low;
    const hash = crypto.createHash('sha256')
        .update(`${guildId}:${messageId}:${hashProfile(profile)}`)
        .digest();
    const value = hash.readUInt32BE(0);
    return low + (value % (high - low + 1));
}

function randomTextXp(settings) {
    if (settings.textXpMax <= settings.textXpMin) return settings.textXpMin;
    return crypto.randomInt(settings.textXpMin, settings.textXpMax + 1);
}

function getMultiplier(member, channelId, settings) {
    const roleMultiplier = settings.roleMultipliers
        .filter(item => item.roleId && member?.roles?.cache?.has(String(item.roleId)))
        .reduce((highest, item) => Math.max(highest, Number(item.multiplier || 1)), 1);
    const channelMultiplier = settings.channelMultipliers
        .filter(item => String(item.channelId) === String(channelId))
        .reduce((highest, item) => Math.max(highest, Number(item.multiplier || 1)), 1);

    return Math.max(0, roleMultiplier * channelMultiplier);
}

function isIgnoredForXp(member, channelId, settings, userId = member?.id) {
    return settings.ignoredChannelIds.includes(String(channelId))
        || settings.ignoredUserIds.includes(String(userId || ''))
        || settings.ignoredRoleIds.some(roleId => member?.roles?.cache?.has(String(roleId)));
}

function normalizeMessageContent(content = '') {
    return String(content).trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSpamLimited(message, settings) {
    if (!settings.antiFarm.enabled) return false;
    const content = normalizeMessageContent(message.content || '');
    if (content.length < settings.antiFarm.minMessageLength) return true;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Number(message.createdTimestamp || Date.now());
    const windowMs = settings.antiFarm.windowSeconds * 1000;
    const repeatedWindowMs = settings.antiFarm.repeatedMessageWindowSeconds * 1000;
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const state = recentTextActivity.get(key) || { messages: [] };
    state.messages = state.messages.filter(item => now - item.at <= Math.max(windowMs, repeatedWindowMs));

    const repeated = repeatedWindowMs > 0 && state.messages.some(item => item.hash === hash && now - item.at <= repeatedWindowMs);
    const overWindow = settings.antiFarm.maxMessagesPerWindow > 0
        && state.messages.filter(item => now - item.at <= windowMs).length >= settings.antiFarm.maxMessagesPerWindow;

    state.messages.push({ at: now, hash });
    recentTextActivity.set(key, state);
    return repeated || overWindow;
}

function getRewardThresholdXp(reward, settings) {
    if (reward.level !== null && reward.level !== undefined) return getXpForLevel(Number(reward.level), settings);
    return Number(reward.xp || 0);
}

function getEarnedRewardRoleIds(record, settings) {
    const totalXp = getTotalXp(record);
    return settings.roleRewards
        .filter(reward => reward.roleId && getRewardThresholdXp(reward, settings) <= totalXp)
        .map(reward => reward.roleId);
}

function canManageRole(member, role) {
    const botMember = member?.guild?.members?.me;
    if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return false;
    if (!role?.editable && typeof role?.editable === 'boolean') return false;
    if (botMember.roles?.highest && role?.position !== undefined && role.position >= botMember.roles.highest.position) return false;
    return true;
}

async function syncRewardRoles(member, record, settings = getLevelingConfig(), options = {}) {
    if (!member || !record) return { added: [], removed: [], skipped: [], errors: [] };
    const force = options.force === true;
    const roleSync = settings.roleSync || {};
    if (!force && roleSync.enabled === false) return { added: [], removed: [], skipped: [], errors: [] };

    const awardMissingRoles = options.awardMissingRoles ?? roleSync.awardMissingRoles === true;
    const removeObsoleteRoles = options.removeObsoleteRoles ?? roleSync.removeObsoleteRoles === true;
    const dryRun = options.dryRun ?? roleSync.dryRun === true;
    const earned = new Set(getEarnedRewardRoleIds(record, settings));
    const managed = new Set(settings.roleRewards.map(reward => reward.roleId).filter(Boolean));
    const added = [];
    const removed = [];
    const skipped = [];
    const errors = [];

    for (const roleId of managed) {
        const hasRole = member.roles?.cache?.has(roleId);
        const shouldHave = earned.has(roleId);
        const role = member.guild?.roles?.cache?.get?.(roleId) || { id: roleId };

        if (shouldHave && !hasRole && awardMissingRoles) {
            if (!canManageRole(member, role)) {
                skipped.push({ roleId, action: 'add', reason: 'missing_manage_roles_or_hierarchy' });
                continue;
            }
            if (!dryRun) {
                try {
                    await member.roles.add(roleId, 'Level reward');
                } catch (error) {
                    errors.push({ roleId, action: 'add', error: error.message });
                    continue;
                }
            }
            added.push(roleId);
        }

        if (!shouldHave && hasRole && removeObsoleteRoles) {
            if (!canManageRole(member, role)) {
                skipped.push({ roleId, action: 'remove', reason: 'missing_manage_roles_or_hierarchy' });
                continue;
            }
            if (!dryRun) {
                try {
                    await member.roles.remove(roleId, 'Obsolete level reward');
                } catch (error) {
                    errors.push({ roleId, action: 'remove', error: error.message });
                    continue;
                }
            }
            removed.push(roleId);
        }
    }

    return { added, removed, skipped, errors };
}

async function applyLevelRoles(member, record, settings = getLevelingConfig()) {
    if (!member || !record) return { added: [], removed: [], skipped: [], errors: [] };
    if (settings.roleSync.syncOnLevelUp === false) return { added: [], removed: [], skipped: [], errors: [] };
    return syncRewardRoles(member, record, settings, {
        awardMissingRoles: settings.roleSync.awardMissingRoles,
        removeObsoleteRoles: settings.roleSync.removeObsoleteRoles,
        dryRun: settings.roleSync.dryRun,
        force: settings.roleSync.enabled !== false,
    });
}

function formatAnnouncement(template, member, progress) {
    return String(template || '')
        .replaceAll('{user}', `<@${member.id}>`)
        .replaceAll('{username}', member.user?.username || member.displayName || member.id)
        .replaceAll('{displayName}', member.displayName || member.user?.username || member.id)
        .replaceAll('{level}', String(progress.level))
        .replaceAll('{xp}', formatXp(progress.totalXp));
}

async function sendLevelAnnouncement(source, member, progress, settings, down = false) {
    const enabled = down ? settings.announceLevelDown : settings.announceLevelUp;
    if (!enabled) return false;
    const guild = member.guild || source.guild;
    const channel = settings.announceChannelId
        ? guild?.channels?.cache?.get?.(settings.announceChannelId)
        : source.channel;
    if (!channel?.send) return false;
    const template = down ? settings.levelDownMessage : settings.levelUpMessage;
    await channel.send({ content: formatAnnouncement(template, member, progress) });
    return true;
}

async function awardTextXp(message) {
    if (!message.guild || message.author?.bot) return null;
    const settings = await getGuildLevelingConfig(message.guild.id);
    if (!allowsTextXp(settings) || message.author?.bot) return null;
    if (isIgnoredForXp(message.member, message.channelId, settings, message.author.id)) return null;
    if (isSpamLimited(message, settings)) return null;

    const baseAmount = randomTextXp(settings);
    const amount = Math.round(baseAmount * getMultiplier(message.member, message.channelId, settings));
    if (amount <= 0) return null;

    const previous = await getUserLevelRecord(message.guild.id, message.author.id);
    const previousProgress = getLevelProgress(previous, settings);
    const record = await addUserXp(
        message.guild.id,
        message.author.id,
        message.author.tag,
        'text',
        amount,
        settings.cooldownSeconds * 1000,
    );
    const changed = getTotalXp(record) !== getTotalXp(previous);
    if (!changed) return record;

    const nextProgress = getLevelProgress(record, settings);
    await applyLevelRoles(message.member, record, settings);
    if (nextProgress.level > previousProgress.level) {
        await sendLevelAnnouncement(message, message.member, nextProgress, settings, false).catch(error => {
            console.error('Failed to send level-up announcement:', error);
        });
    } else if (nextProgress.level < previousProgress.level) {
        await sendLevelAnnouncement(message, message.member, nextProgress, settings, true).catch(error => {
            console.error('Failed to send level-down announcement:', error);
        });
    }
    return record;
}

function voiceStateKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isVoiceEligible(member, channel, settings) {
    if (!member || member.user?.bot) return false;
    if (isIgnoredForXp(member, channel.id, settings, member.id)) return false;
    const eligibility = settings.voiceEligibility;
    if (!eligibility.allowAfk && member.guild?.afkChannelId && member.guild.afkChannelId === channel.id) return false;
    if (!eligibility.allowDeafened && (member.voice?.selfDeaf || member.voice?.serverDeaf)) return false;
    if (!eligibility.allowSolo) {
        const humanCount = [...(channel.members?.values?.() || [])].filter(item => !item.user?.bot).length;
        if (humanCount <= 1) return false;
    }
    return true;
}

async function awardVoiceXp(client) {
    let awarded = 0;
    const seen = new Set();
    const now = Date.now();

    for (const guild of client.guilds.cache.values()) {
        const settings = await getGuildLevelingConfig(guild.id);
        if (!allowsVoiceXp(settings)) continue;

        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased?.()) continue;

            for (const member of channel.members.values()) {
                if (!isVoiceEligible(member, channel, settings)) continue;
                const key = voiceStateKey(guild.id, member.id);
                seen.add(key);
                const lastAwardedAt = voiceAwardState.get(key);
                if (!lastAwardedAt) {
                    voiceAwardState.set(key, now);
                    continue;
                }
                if (now - lastAwardedAt < 60_000) continue;

                const amount = Math.round(settings.voiceXpPerMinute * getMultiplier(member, channel.id, settings));
                voiceAwardState.set(key, now);
                if (amount <= 0) continue;
                const record = await addUserXp(guild.id, member.id, member.user.tag, 'voice', amount);
                await applyLevelRoles(member, record, settings);
                awarded += 1;
            }
        }
    }

    for (const key of voiceAwardState.keys()) {
        if (!seen.has(key)) voiceAwardState.delete(key);
    }

    return { awarded };
}

function startLevelingScheduler(client) {
    const run = () => awardVoiceXp(client).catch(error => console.error('Voice XP scheduler failed:', error));
    run();
    return setInterval(run, 60 * 1000);
}

function inferLevelFromRoles(member, mappings = []) {
    return array(mappings)
        .filter(mapping => mapping.roleId && member?.roles?.cache?.has(String(mapping.roleId)))
        .reduce((highest, mapping) => Math.max(highest, Number(mapping.minimumLevel || 0)), 0);
}

function reconcileLevelEstimates({
    existingXp = 0,
    messageEstimatedXp = 0,
    roleMinLevel = 0,
    settings = getLevelingConfig(),
    policy = 'max',
} = {}) {
    const roleMinXp = roleMinLevel > 0 ? getXpForLevel(roleMinLevel, settings) : 0;
    const safeExistingXp = Math.max(0, Number(existingXp || 0));
    const safeMessageXp = Math.max(0, Number(messageEstimatedXp || 0));
    let selected = Math.max(safeMessageXp, roleMinXp);

    if (policy === 'messages_only') selected = safeMessageXp;
    if (policy === 'roles_only') selected = roleMinXp;

    return {
        existingXp: safeExistingXp,
        messageEstimatedXp: safeMessageXp,
        messageEstimatedLevel: getLevelProgress({ textXp: safeMessageXp, voiceXp: 0 }, settings).level,
        roleMinLevel,
        roleMinXp,
        finalXp: Math.max(safeExistingXp, selected),
        policy,
    };
}

module.exports = {
    adjustUserXp,
    allowsTextXp,
    allowsVoiceXp,
    applyLevelRoles,
    awardTextXp,
    awardVoiceXp,
    canManageRole,
    deterministicHistoricalXp,
    formatProgressBar,
    formatXp,
    getEarnedRewardRoleIds,
    getGuildLevelingConfig,
    getLevelProgress,
    getLevelRank,
    getLevelingConfig,
    getMultiplier,
    getRewardThresholdXp,
    getTotalXp,
    getUserLevelRecord,
    getXpForLevel,
    getXpNeededForNextLevel,
    hashProfile,
    historicalProfileFromSettings,
    inferLevelFromRoles,
    isIgnoredForXp,
    isVoiceEligible,
    listLevelLeaderboard,
    previewFormulaImpact,
    reconcileLevelEstimates,
    setUserXp,
    setUserXpMinimum,
    stableJson,
    startLevelingScheduler,
    syncRewardRoles,
};
