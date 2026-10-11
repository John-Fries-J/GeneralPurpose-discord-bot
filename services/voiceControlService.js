const { PermissionFlagsBits } = require('discord.js');
const {
    deleteTemporaryVoiceChannel,
    getGuildJoinToCreateConfig,
    getHumanMembers,
    transferOwnership,
} = require('../utils/joinToCreate');
const { getTempVoiceChannel, upsertTempVoiceChannel } = require('../utils/store');
const { emitDomainEvent } = require('./domainEvents');

class VoiceControlError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'VoiceControlError';
        this.code = code;
        this.status = status;
    }
}

function toSnowflake(value, field = 'id') {
    const text = String(value || '').trim();
    if (!/^\d{6,30}$/.test(text)) {
        throw new VoiceControlError('invalid_id', `${field} is invalid.`, 400);
    }
    return text;
}

async function fetchGuild(client, guildId) {
    const id = toSnowflake(guildId, 'guildId');
    const guild = client.guilds?.cache?.get(id) || await client.guilds?.fetch?.(id).catch(() => null);
    if (!guild) throw new VoiceControlError('guild_not_found', 'This server is not available to the bot.', 404);
    return guild;
}

async function fetchGuildMember(guild, userId) {
    const id = toSnowflake(userId, 'userId');
    const member = guild.members?.cache?.get(id) || await guild.members?.fetch?.(id).catch(() => null);
    if (!member) throw new VoiceControlError('member_not_found', 'You are not a member of this server.', 403);
    return member;
}

async function fetchVoiceChannel(guild, channelId) {
    if (!channelId) return null;
    return guild.channels?.cache?.get(channelId) || await guild.channels?.fetch?.(channelId).catch(() => null);
}

function userAvatarUrl(member) {
    return member.displayAvatarURL?.({ size: 64 })
        || member.user?.displayAvatarURL?.({ size: 64 })
        || null;
}

function serializeMember(member, ownerId) {
    return {
        id: member.id,
        displayName: member.displayName || member.user?.globalName || member.user?.username || member.id,
        username: member.user?.username || member.id,
        avatarUrl: userAvatarUrl(member),
        bot: member.user?.bot === true,
        owner: member.id === ownerId,
    };
}

function serializeChannel(channel, record) {
    const members = getHumanMembers(channel).map(member => serializeMember(member, record.ownerId));
    const userLimit = Number(channel.userLimit || record.userLimit || 0);

    return {
        id: channel.id,
        name: channel.name || record.name || 'Temporary Voice',
        ownerId: record.ownerId,
        locked: record.locked === true,
        userLimit,
        memberCount: members.length,
        members,
        createdAt: record.createdAt || null,
        transferredAt: record.transferredAt || null,
    };
}

async function getTemporaryVoiceState(client, guildId, userId) {
    const guild = await fetchGuild(client, guildId);
    const member = await fetchGuildMember(guild, userId);
    const channel = member.voice?.channel || null;

    if (!channel) {
        return {
            ok: true,
            guild: { id: guild.id, name: guild.name || guild.id },
            channel: null,
            owned: false,
            reason: 'not_in_voice',
        };
    }

    const record = await getTempVoiceChannel(channel.id);
    if (!record || record.guildId !== guild.id) {
        return {
            ok: true,
            guild: { id: guild.id, name: guild.name || guild.id },
            channel: null,
            owned: false,
            reason: 'not_temporary',
        };
    }

    return {
        ok: true,
        guild: { id: guild.id, name: guild.name || guild.id },
        channel: serializeChannel(channel, record),
        owned: record.ownerId === userId,
        reason: record.ownerId === userId ? null : 'not_owner',
    };
}

async function requireOwnedTemporaryVoiceChannel(client, guildId, userId) {
    const guild = await fetchGuild(client, guildId);
    const member = await fetchGuildMember(guild, userId);
    const channel = member.voice?.channel || null;

    if (!channel) {
        throw new VoiceControlError('not_in_voice', 'Join your temporary voice channel first.', 403);
    }

    const record = await getTempVoiceChannel(channel.id);
    if (!record || record.guildId !== guild.id) {
        throw new VoiceControlError('not_temporary_channel', 'This is not a temporary join-to-create channel.', 404);
    }
    if (record.ownerId !== userId) {
        throw new VoiceControlError('not_owner', 'You can only manage a temporary voice channel that you own.', 403);
    }

    return { guild, member, channel, record };
}

function emitVoiceUpdate(type, guild, channel, record, payload = {}) {
    emitDomainEvent(type, {
        channelId: channel?.id || record?.channelId || null,
        ownerId: record?.ownerId || null,
        ...payload,
    }, {
        guildId: guild?.id || record?.guildId,
        channelId: channel?.id || record?.channelId,
        userId: record?.ownerId,
    });
}

function validateChannelName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100) {
        throw new VoiceControlError('invalid_name', 'Channel name must be 2 to 100 characters.', 400);
    }
    if (/[\u0000-\u001f\u007f]/.test(name)) {
        throw new VoiceControlError('invalid_name', 'Channel name cannot contain control characters.', 400);
    }
    return name;
}

async function renameOwnedVoiceChannel(client, guildId, userId, value, reason = 'Voice owner renamed channel') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    const name = validateChannelName(value);
    await owned.channel.setName(name, reason);
    const record = { ...owned.record, name, userLimit: owned.channel.userLimit || 0, lastOccupiedAt: Date.now() };
    await upsertTempVoiceChannel(record);
    emitVoiceUpdate('voice:updated', owned.guild, owned.channel, record, { field: 'name' });
    return serializeChannel(owned.channel, record);
}

async function setOwnedVoiceLimit(client, guildId, userId, value, reason = 'Voice owner changed user limit') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    const amount = Number(value);
    const max = Number((await getGuildJoinToCreateConfig(owned.guild.id)).userLimitMax || 25);
    if (!Number.isInteger(amount) || amount < 0 || amount > max) {
        throw new VoiceControlError('invalid_limit', `Enter a whole number from 0 to ${max}.`, 400);
    }

    await owned.channel.setUserLimit(amount, reason);
    const record = { ...owned.record, userLimit: amount, name: owned.channel.name, lastOccupiedAt: Date.now() };
    await upsertTempVoiceChannel(record);
    emitVoiceUpdate('voice:updated', owned.guild, owned.channel, record, { field: 'userLimit' });
    return serializeChannel(owned.channel, record);
}

async function setOwnedVoiceLock(client, guildId, userId, locked, reason) {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    await owned.channel.permissionOverwrites.edit(owned.guild.roles.everyone, { Connect: locked ? false : true }, reason);
    const record = {
        ...owned.record,
        locked: locked === true,
        name: owned.channel.name,
        userLimit: owned.channel.userLimit || 0,
        lastOccupiedAt: Date.now(),
    };
    await upsertTempVoiceChannel(record);
    emitVoiceUpdate(locked ? 'voice:locked' : 'voice:unlocked', owned.guild, owned.channel, record);
    return serializeChannel(owned.channel, record);
}

async function lockOwnedVoiceChannel(client, guildId, userId, reason = 'Voice owner locked channel') {
    return setOwnedVoiceLock(client, guildId, userId, true, reason);
}

async function unlockOwnedVoiceChannel(client, guildId, userId, reason = 'Voice owner unlocked channel') {
    return setOwnedVoiceLock(client, guildId, userId, false, reason);
}

async function permitVoiceMember(client, guildId, userId, targetUserId, reason = 'Voice owner permitted user') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    const targetId = toSnowflake(targetUserId, 'targetUserId');
    await fetchGuildMember(owned.guild, targetId);
    await owned.channel.permissionOverwrites.edit(targetId, { Connect: true, ViewChannel: true }, reason);
    emitVoiceUpdate('voice:updated', owned.guild, owned.channel, owned.record, { field: 'permit', targetUserId: targetId });
    return serializeChannel(owned.channel, owned.record);
}

async function rejectVoiceMember(client, guildId, userId, targetUserId, reason = 'Voice owner rejected user') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    const targetId = toSnowflake(targetUserId, 'targetUserId');
    const target = await fetchGuildMember(owned.guild, targetId);
    await owned.channel.permissionOverwrites.edit(targetId, { Connect: false }, reason);
    if (target?.voice?.channelId === owned.channel.id && owned.guild.members.me?.permissions?.has?.(PermissionFlagsBits.MoveMembers)) {
        await target.voice.disconnect('Rejected from join-to-create channel').catch(() => null);
    }
    emitVoiceUpdate('voice:updated', owned.guild, owned.channel, owned.record, { field: 'reject', targetUserId: targetId });
    return serializeChannel(owned.channel, owned.record);
}

async function transferOwnedVoiceChannel(client, guildId, userId, targetUserId, reason = 'Voice owner transferred channel') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    const targetId = toSnowflake(targetUserId, 'targetUserId');
    const target = owned.channel.members.get(targetId) || await fetchGuildMember(owned.guild, targetId);
    if (!target || target.voice?.channelId !== owned.channel.id || target.user?.bot) {
        throw new VoiceControlError('invalid_owner', 'Choose a human member currently in your voice channel.', 400);
    }

    const updated = await transferOwnership(owned.record, owned.channel, target, { reason });
    return serializeChannel(owned.channel, updated);
}

async function deleteOwnedVoiceChannel(client, guildId, userId, reason = 'Voice owner deleted temporary channel') {
    const owned = await requireOwnedTemporaryVoiceChannel(client, guildId, userId);
    await deleteTemporaryVoiceChannel(owned.guild, owned.channel.id, reason, { force: true });
    return { deleted: true, channelId: owned.channel.id };
}

async function claimTemporaryVoiceChannel(client, guildId, userId) {
    const guild = await fetchGuild(client, guildId);
    const member = await fetchGuildMember(guild, userId);
    const channel = member.voice?.channel;
    if (!channel) throw new VoiceControlError('not_in_voice', 'Join the temporary voice channel first.', 403);

    const record = await getTempVoiceChannel(channel.id);
    if (!record || record.guildId !== guild.id) {
        throw new VoiceControlError('not_temporary_channel', 'This is not a temporary join-to-create channel.', 404);
    }
    if (record.ownerId === userId) {
        throw new VoiceControlError('already_owner', 'You already own this channel.', 400);
    }
    if (channel.members.has(record.ownerId)) {
        throw new VoiceControlError('owner_present', 'The current owner is still in the channel.', 403);
    }

    const updated = await transferOwnership(record, channel, member);
    return serializeChannel(channel, updated);
}

module.exports = {
    VoiceControlError,
    claimTemporaryVoiceChannel,
    deleteOwnedVoiceChannel,
    fetchGuild,
    fetchGuildMember,
    getTemporaryVoiceState,
    lockOwnedVoiceChannel,
    permitVoiceMember,
    rejectVoiceMember,
    renameOwnedVoiceChannel,
    requireOwnedTemporaryVoiceChannel,
    serializeChannel,
    setOwnedVoiceLimit,
    transferOwnedVoiceChannel,
    unlockOwnedVoiceChannel,
};
