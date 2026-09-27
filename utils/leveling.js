const { getConfig } = require('./config');
const { addUserXp, getUserLevelRecord, listLevelLeaderboard } = require('./store');

function getLevelingConfig(config = getConfig()) {
    return {
        enabled: config.leveling?.enabled === true,
        mode: config.leveling?.mode || 'text',
        textXpPerMessage: Number(config.leveling?.textXpPerMessage || 1),
        voiceXpPerMinute: Number(config.leveling?.voiceXpPerMinute || 1),
        cooldownSeconds: Number(config.leveling?.cooldownSeconds || 60),
        roleRewards: Array.isArray(config.leveling?.roleRewards) ? config.leveling.roleRewards : [],
    };
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
    const settings = getLevelingConfig();
    if (!allowsTextXp(settings) || !message.guild || message.author?.bot) return null;

    const record = await addUserXp(
        message.guild.id,
        message.author.id,
        message.author.tag,
        'text',
        settings.textXpPerMessage,
        settings.cooldownSeconds * 1000,
    );

    await applyLevelRoles(message.member, record, settings);
    return record;
}

async function awardVoiceXp(client) {
    const settings = getLevelingConfig();
    if (!allowsVoiceXp(settings)) return;

    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased?.()) continue;

            for (const member of channel.members.values()) {
                if (member.user.bot) continue;
                const record = await addUserXp(guild.id, member.id, member.user.tag, 'voice', settings.voiceXpPerMinute);
                await applyLevelRoles(member, record, settings);
            }
        }
    }
}

function startLevelingScheduler(client) {
    const run = () => awardVoiceXp(client).catch(error => console.error('Voice XP scheduler failed:', error));
    return setInterval(run, 60 * 1000);
}

module.exports = {
    allowsTextXp,
    allowsVoiceXp,
    applyLevelRoles,
    awardTextXp,
    awardVoiceXp,
    getLevelingConfig,
    getTotalXp,
    getUserLevelRecord,
    listLevelLeaderboard,
    startLevelingScheduler,
};
