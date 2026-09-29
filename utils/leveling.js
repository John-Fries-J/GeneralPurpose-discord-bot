const { getConfig } = require('./config');
const { getGuildSettings } = require('./guildConfig');
const { addUserXp, getUserLevelRecord, listLevelLeaderboard } = require('./store');

function getLevelingConfig(config = getConfig()) {
    return {
        enabled: config.leveling?.enabled === true,
        mode: config.leveling?.mode || 'text',
        textXpPerMessage: Number(config.leveling?.textXpPerMessage ?? 1),
        voiceXpPerMinute: Number(config.leveling?.voiceXpPerMinute ?? 1),
        cooldownSeconds: Number(config.leveling?.cooldownSeconds ?? 60),
        roleRewards: Array.isArray(config.leveling?.roleRewards) ? config.leveling.roleRewards : [],
        ignoredChannelIds: Array.isArray(config.leveling?.ignoredChannelIds) ? config.leveling.ignoredChannelIds : [],
        ignoredRoleIds: Array.isArray(config.leveling?.ignoredRoleIds) ? config.leveling.ignoredRoleIds : [],
        roleMultipliers: Array.isArray(config.leveling?.roleMultipliers) ? config.leveling.roleMultipliers : [],
        channelMultipliers: Array.isArray(config.leveling?.channelMultipliers) ? config.leveling.channelMultipliers : [],
        xpPerLevelBase: Number(config.leveling?.xpPerLevelBase ?? 100),
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

function getXpForLevel(level, settings = getLevelingConfig()) {
    const safeLevel = Math.max(0, Number(level) || 0);
    const base = Math.max(1, Number(settings.xpPerLevelBase || 100));
    return Math.floor((base * safeLevel * (safeLevel + 1)) / 2);
}

function getLevelProgress(record, settings = getLevelingConfig()) {
    const totalXp = getTotalXp(record);
    let level = 0;

    while (totalXp >= getXpForLevel(level + 1, settings)) {
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

function formatProgressBar(percent, size = 20) {
    const safePercent = Math.max(0, Math.min(1, Number(percent) || 0));
    const filled = Math.round(safePercent * size);
    return `[${'#'.repeat(filled)}${'-'.repeat(size - filled)}]`;
}

function formatXp(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function getMultiplier(member, channelId, settings) {
    const roleMultiplier = settings.roleMultipliers
        .filter(item => item.roleId && member?.roles?.cache?.has(item.roleId))
        .reduce((highest, item) => Math.max(highest, Number(item.multiplier || 1)), 1);
    const channelMultiplier = settings.channelMultipliers
        .filter(item => item.channelId === channelId)
        .reduce((highest, item) => Math.max(highest, Number(item.multiplier || 1)), 1);

    return Math.max(0, roleMultiplier * channelMultiplier);
}

function isIgnoredForXp(member, channelId, settings) {
    return settings.ignoredChannelIds.includes(channelId)
        || settings.ignoredRoleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

async function applyLevelRoles(member, record, settings = getLevelingConfig()) {
    if (!member || !record) return;

    const totalXp = getTotalXp(record);
    const rewards = settings.roleRewards
        .filter(reward => reward.roleId && Number(reward.xp) <= totalXp)
        .sort((a, b) => Number(a.xp) - Number(b.xp));

    for (const reward of rewards) {
        if (!member.roles.cache.has(reward.roleId)) {
            await member.roles.add(reward.roleId, 'Level reward').catch(error => {
                console.error(`Failed to add level role ${reward.roleId}:`, error);
            });
        }
    }
}

async function awardTextXp(message) {
    if (!message.guild || message.author?.bot) return null;
    const settings = await getGuildLevelingConfig(message.guild.id);
    if (!allowsTextXp(settings) || message.author?.bot) return null;
    if (isIgnoredForXp(message.member, message.channelId, settings)) return null;

    const amount = Math.round(settings.textXpPerMessage * getMultiplier(message.member, message.channelId, settings));
    if (amount <= 0) return null;

    const record = await addUserXp(
        message.guild.id,
        message.author.id,
        message.author.tag,
        'text',
        amount,
        settings.cooldownSeconds * 1000,
    );

    await applyLevelRoles(message.member, record, settings);
    return record;
}

async function awardVoiceXp(client) {
    let awarded = 0;

    for (const guild of client.guilds.cache.values()) {
        const settings = await getGuildLevelingConfig(guild.id);
        if (!allowsVoiceXp(settings)) continue;

        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased?.()) continue;

            for (const member of channel.members.values()) {
                if (member.user.bot) continue;
                if (isIgnoredForXp(member, channel.id, settings)) continue;
                const amount = Math.round(settings.voiceXpPerMinute * getMultiplier(member, channel.id, settings));
                if (amount <= 0) continue;
                const record = await addUserXp(guild.id, member.id, member.user.tag, 'voice', amount);
                await applyLevelRoles(member, record, settings);
                awarded += 1;
            }
        }
    }

    return { awarded };
}

function startLevelingScheduler(client) {
    const run = () => awardVoiceXp(client).catch(error => console.error('Voice XP scheduler failed:', error));
    run();
    return setInterval(run, 60 * 1000);
}

module.exports = {
    allowsTextXp,
    allowsVoiceXp,
    applyLevelRoles,
    awardTextXp,
    awardVoiceXp,
    getLevelingConfig,
    getLevelProgress,
    getGuildLevelingConfig,
    getMultiplier,
    getTotalXp,
    getUserLevelRecord,
    getXpForLevel,
    formatProgressBar,
    formatXp,
    isIgnoredForXp,
    listLevelLeaderboard,
    startLevelingScheduler,
};
