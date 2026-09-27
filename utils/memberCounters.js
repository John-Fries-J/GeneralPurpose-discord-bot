const { ChannelType } = require('discord.js');
const { getConfig } = require('./config');

function getMemberCounters(config = getConfig()) {
    return Array.isArray(config.memberCounters) ? config.memberCounters.filter(counter => counter.enabled !== false) : [];
}

async function countCounter(guild, counter) {
    await guild.members.fetch().catch(() => null);

    if (counter.type === 'bots') {
        return guild.members.cache.filter(member => member.user.bot).size;
    }

    if (counter.type === 'boosters') {
        return guild.members.cache.filter(member => Boolean(member.premiumSince)).size;
    }

    if (counter.type === 'role') {
        return guild.members.cache.filter(member => member.roles.cache.has(counter.roleId)).size;
    }

    return guild.memberCount || guild.members.cache.size;
}

function formatCounterName(counter, count) {
    const fallbackNames = {
        members: 'Members: {count}',
        bots: 'Bots: {count}',
        boosters: 'Boosters: {count}',
        role: 'Role Members: {count}',
    };

    return (counter.nameFormat || fallbackNames[counter.type] || '{count}')
        .replaceAll('{count}', `${count}`)
        .slice(0, 100);
}

async function refreshMemberCounter(guild, counter) {
    const channel = guild.channels.cache.get(counter.channelId) || await guild.channels.fetch(counter.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) return false;

    const count = await countCounter(guild, counter);
    const name = formatCounterName(counter, count);

    if (channel.name !== name) {
        await channel.setName(name, 'Refreshing member counter');
    }

    return true;
}

async function refreshMemberCounters(clientOrGuild, guildId = null) {
    const guilds = guildId
        ? [clientOrGuild.guilds.cache.get(guildId)].filter(Boolean)
        : clientOrGuild.guilds
            ? [...clientOrGuild.guilds.cache.values()]
            : [clientOrGuild];

    const results = [];

    for (const guild of guilds) {
        const counters = getMemberCounters().filter(counter => !counter.guildId || counter.guildId === guild.id);
        for (const counter of counters) {
            results.push(await refreshMemberCounter(guild, counter).catch(error => {
                console.error(`Failed to refresh counter ${counter.channelId}:`, error);
                return false;
            }));
        }
    }

    return results.filter(Boolean).length;
}

function startMemberCounterScheduler(client) {
    const run = () => refreshMemberCounters(client).catch(error => console.error('Member counter refresh failed:', error));
    run();
    return setInterval(run, 5 * 60 * 1000);
}

module.exports = {
    formatCounterName,
    getMemberCounters,
    refreshMemberCounter,
    refreshMemberCounters,
    startMemberCounterScheduler,
};
