const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { getGuildSettings } = require('./guildConfig');
const { getTempVoiceChannel, listTempVoiceChannelsForGuild, removeTempVoiceChannel, upsertTempVoiceChannel } = require('./store');

const emptyDeletionTimers = new Map();
const channelLocks = new Map();

function getJoinToCreateConfig(config = getConfig()) {
    return {
        enabled: config.joinToCreate?.enabled === true,
        triggerChannelId: config.joinToCreate?.triggerChannelId || '',
        categoryId: config.joinToCreate?.categoryId || '',
        nameFormat: config.joinToCreate?.nameFormat || "{username}'s Channel",
        userLimitMax: Number(config.joinToCreate?.userLimitMax ?? 25),
        emptyGraceMs: Number(config.joinToCreate?.emptyGraceMs ?? 10_000),
    };
}

async function getGuildJoinToCreateConfig(guildId) {
    return getJoinToCreateConfig(await getGuildSettings(guildId));
}

async function withChannelLock(channelId, callback) {
    const previous = channelLocks.get(channelId) || Promise.resolve();
    let release;
    const current = new Promise(resolve => {
        release = resolve;
    });
    const tail = previous.catch(() => null).then(() => current);
    channelLocks.set(channelId, tail);

    await previous.catch(() => null);
    try {
        return await callback();
    } finally {
        release();
        if (channelLocks.get(channelId) === tail) channelLocks.delete(channelId);
    }
}

function getHumanMembers(channel) {
    return [...(channel?.members?.values?.() || [])]
        .filter(member => !member.user?.bot)
        .sort((a, b) => String(a.joinedTimestamp || a.id).localeCompare(String(b.joinedTimestamp || b.id)));
}

function formatVoiceChannelName(template, member) {
    const values = {
        displayName: member.displayName || member.user?.globalName || member.user?.username || 'User',
        globalName: member.user?.globalName || member.displayName || member.user?.username || 'User',
        id: member.id,
        mention: `<@${member.id}>`,
        tag: member.user?.tag || member.user?.username || member.id,
        user: member.user?.username || member.displayName || 'User',
        username: member.user?.username || member.displayName || 'User',
    };

    return String(template || "{username}'s Channel")
        .replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match)
        .slice(0, 100);
}

async function sendJoinToCreateIntro(channel, member) {
    if (!channel?.send) return false;

    return channel.send({
        content: [
            `<@${member.id}> this is your temporary voice channel.`,
            'Use `/voice rename`, `/voice limit`, `/voice lock`, `/voice unlock`, `/voice permit`, and `/voice reject` to edit it.',
            'It will be deleted automatically when everyone leaves.',
        ].join('\n'),
        allowedMentions: { users: [member.id] },
    }).then(() => true).catch(() => false);
}

function cancelEmptyDeletion(channelId) {
    const timer = emptyDeletionTimers.get(channelId);
    if (!timer) return false;
    clearTimeout(timer);
    emptyDeletionTimers.delete(channelId);
    return true;
}

async function deleteTemporaryVoiceChannelUnlocked(guild, channelId, reason, { force = false } = {}) {
    cancelEmptyDeletion(channelId);
    const record = await getTempVoiceChannel(channelId);
    if (!record) return false;

    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        await removeTempVoiceChannel(channelId);
        return true;
    }

    const humans = getHumanMembers(channel);
    if (!force && humans.length > 0) {
        await upsertTempVoiceChannel({
            ...record,
            lastOccupiedAt: Date.now(),
        });
        return false;
    }

    const botMember = guild.members.me || await guild.members.fetchMe?.().catch(() => null);
    if (botMember?.voice?.channelId === channel.id) {
        await botMember.voice.disconnect(reason).catch(() => null);
    }

    await channel.delete(reason).catch(() => null);
    await removeTempVoiceChannel(channelId);
    return true;
}

async function deleteTemporaryVoiceChannel(guild, channelId, reason = 'Deleting empty join-to-create channel', options = {}) {
    return withChannelLock(channelId, () => deleteTemporaryVoiceChannelUnlocked(guild, channelId, reason, options));
}

function scheduleEmptyChannelDeletion(guild, channelId, delayMs, reason) {
    cancelEmptyDeletion(channelId);
    const timer = setTimeout(() => {
        emptyDeletionTimers.delete(channelId);
        deleteTemporaryVoiceChannel(guild, channelId, reason).catch(error => {
            console.error(`Failed to delete empty join-to-create channel ${channelId}:`, error);
        });
    }, delayMs);
    emptyDeletionTimers.set(channelId, timer);
    return timer;
}

async function transferOwnership(record, channel, nextOwner) {
    if (!record || !channel || !nextOwner || record.ownerId === nextOwner.id) return record;

    const previousOwnerId = record.ownerId;
    const updated = {
        ...record,
        ownerId: nextOwner.id,
        transferredAt: Date.now(),
        lastOccupiedAt: Date.now(),
    };

    await upsertTempVoiceChannel(updated);
    await channel.permissionOverwrites.edit(nextOwner.id, {
        Connect: true,
        ManageChannels: true,
        MoveMembers: true,
        ViewChannel: true,
    }).catch(() => null);
    await channel.permissionOverwrites.edit(previousOwnerId, {
        ManageChannels: null,
        MoveMembers: null,
    }).catch(() => null);
    await channel.send?.(`<@${nextOwner.id}> is now the temporary voice channel owner.`).catch(() => null);
    return updated;
}

async function deleteJoinToCreateChannels(guild) {
    const records = await listTempVoiceChannelsForGuild(guild.id);
    let deleted = 0;

    for (const record of records) {
        const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
        if (!channel) {
            await removeTempVoiceChannel(record.channelId);
            continue;
        }
        await channel.delete('Join-to-create disabled').then(() => {
            deleted += 1;
            return removeTempVoiceChannel(record.channelId);
        }).catch(error => {
            console.error(`Failed to delete join-to-create channel ${record.channelId}:`, error);
        });
    }

    return deleted;
}

async function handleJoinToCreate(oldState, newState) {
    const settings = await getGuildJoinToCreateConfig(newState.guild.id);
    if (!settings.enabled) return;

    if (newState.channelId === settings.triggerChannelId && oldState.channelId !== newState.channelId) {
        const channel = await newState.guild.channels.create({
            name: formatVoiceChannelName(settings.nameFormat, newState.member),
            type: ChannelType.GuildVoice,
            parent: settings.categoryId || newState.channel?.parentId || null,
            permissionOverwrites: [
                {
                    id: newState.member.id,
                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.MoveMembers,
                        PermissionFlagsBits.ViewChannel,
                    ],
                },
                {
                    id: newState.guild.roles.everyone.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
                },
            ],
            reason: 'Join-to-create voice channel',
        });

        await upsertTempVoiceChannel({
            guildId: newState.guild.id,
            channelId: channel.id,
            ownerId: newState.member.id,
            triggerChannelId: settings.triggerChannelId,
            name: channel.name,
            locked: false,
            userLimit: channel.userLimit || 0,
            lastOccupiedAt: Date.now(),
            createdAt: Date.now(),
        });
        await newState.setChannel(channel, 'Moving user to join-to-create channel').catch(() => null);
        await sendJoinToCreateIntro(channel, newState.member);
        return;
    }

    if (newState.channelId && newState.channelId !== oldState.channelId) {
        const joinedRecord = await getTempVoiceChannel(newState.channelId);
        if (joinedRecord) cancelEmptyDeletion(newState.channelId);
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await withChannelLock(oldState.channelId, async () => {
            const record = await getTempVoiceChannel(oldState.channelId);
            if (!record) return;

            const oldChannel = oldState.guild.channels.cache.get(oldState.channelId) || await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);
            if (!oldChannel) {
                await removeTempVoiceChannel(oldState.channelId);
                return;
            }

            const humans = getHumanMembers(oldChannel);
            if (humans.length === 0) {
                await upsertTempVoiceChannel({
                    ...record,
                    lastOccupiedAt: Date.now(),
                });
                scheduleEmptyChannelDeletion(oldState.guild, oldState.channelId, settings.emptyGraceMs, 'Deleting empty join-to-create channel after grace period');
            } else if (record.ownerId === oldState.member?.id) {
                await transferOwnership(record, oldChannel, humans[0]);
            }
        });
    }
}

async function reconcileGuildTempVoiceChannels(guild) {
    const records = await listTempVoiceChannelsForGuild(guild.id);
    let preserved = 0;
    let removed = 0;
    let transferred = 0;

    for (const record of records) {
        await withChannelLock(record.channelId, async () => {
            const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
            if (!channel) {
                await removeTempVoiceChannel(record.channelId);
                removed += 1;
                return;
            }

            const humans = getHumanMembers(channel);
            if (humans.length === 0) {
                await deleteTemporaryVoiceChannelUnlocked(guild, record.channelId, 'Startup cleanup of empty join-to-create channel');
                removed += 1;
                return;
            }

            if (!humans.some(member => member.id === record.ownerId)) {
                await transferOwnership(record, channel, humans[0]);
                transferred += 1;
            } else {
                await upsertTempVoiceChannel({
                    ...record,
                    lastOccupiedAt: Date.now(),
                    name: channel.name,
                    userLimit: channel.userLimit || 0,
                });
                preserved += 1;
            }
        });
    }

    return { guildId: guild.id, records: records.length, preserved, removed, transferred };
}

async function reconcileJoinToCreate(client) {
    const results = [];
    for (const guild of client.guilds.cache.values()) {
        results.push(await reconcileGuildTempVoiceChannels(guild));
    }
    return results;
}

async function getOwnedVoiceChannel(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) return { ok: false, message: 'Join your temporary voice channel first.' };

    const record = await getTempVoiceChannel(channel.id);
    if (!record || record.ownerId !== interaction.user.id) {
        return { ok: false, message: 'You can only manage a temporary voice channel that you own.' };
    }

    return { ok: true, channel, record };
}

module.exports = {
    deleteJoinToCreateChannels,
    deleteTemporaryVoiceChannel,
    formatVoiceChannelName,
    getJoinToCreateConfig,
    getGuildJoinToCreateConfig,
    getOwnedVoiceChannel,
    handleJoinToCreate,
    reconcileGuildTempVoiceChannels,
    reconcileJoinToCreate,
    scheduleEmptyChannelDeletion,
    transferOwnership,
};
