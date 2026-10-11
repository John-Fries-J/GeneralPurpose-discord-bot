const { ChannelType } = require('discord.js');
const { fetchGuild, fetchGuildMember } = require('../../services/voiceControlService');

class ActivityApiError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'ActivityApiError';
        this.code = code;
        this.status = status;
    }
}

function normalizeOptionalSnowflake(value, field) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{6,30}$/.test(text)) throw new ActivityApiError('invalid_context', `${field} is invalid.`, 400);
    return text;
}

function readActivityContext(req) {
    const bodyContext = req.body?.context || {};
    return {
        guildId: normalizeOptionalSnowflake(req.get('x-activity-guild-id') || req.query.guildId || bodyContext.guildId || req.body?.guildId, 'guildId'),
        channelId: normalizeOptionalSnowflake(req.get('x-activity-channel-id') || req.query.channelId || bodyContext.channelId || req.body?.channelId, 'channelId'),
        instanceId: String(req.get('x-activity-instance-id') || req.query.instanceId || bodyContext.instanceId || req.body?.instanceId || '').trim().slice(0, 128) || null,
    };
}

function channelTypeLabel(channel) {
    if (!channel) return null;
    if (channel.type === ChannelType.GuildVoice) return 'voice';
    if (channel.type === ChannelType.GuildStageVoice) return 'stage';
    if (channel.type === ChannelType.GuildText) return 'text';
    if (channel.type === ChannelType.GuildAnnouncement) return 'announcement';
    return String(channel.type);
}

async function verifyActivityContext(client, session, requestedContext = {}) {
    if (!requestedContext.guildId) {
        throw new ActivityApiError('missing_guild', 'The Activity must be opened in a server context.', 400);
    }

    const guild = await fetchGuild(client, requestedContext.guildId);
    const member = await fetchGuildMember(guild, session.user.id);
    let channel = null;
    if (requestedContext.channelId) {
        channel = guild.channels?.cache?.get(requestedContext.channelId)
            || await guild.channels?.fetch?.(requestedContext.channelId).catch(() => null);
        if (!channel || channel.guild?.id !== guild.id) {
            throw new ActivityApiError('invalid_channel', 'The Activity channel is not available in this server.', 400);
        }
    }

    return {
        guild,
        member,
        channel,
        instanceId: requestedContext.instanceId,
    };
}

function serializeContext(verified) {
    return {
        guild: {
            id: verified.guild.id,
            name: verified.guild.name || verified.guild.id,
            iconUrl: verified.guild.iconURL?.({ size: 64 }) || null,
        },
        channel: verified.channel ? {
            id: verified.channel.id,
            name: verified.channel.name || verified.channel.id,
            type: channelTypeLabel(verified.channel),
        } : null,
        member: {
            id: verified.member.id,
            displayName: verified.member.displayName || verified.member.user?.globalName || verified.member.user?.username || verified.member.id,
            avatarUrl: verified.member.displayAvatarURL?.({ size: 64 }) || verified.member.user?.displayAvatarURL?.({ size: 64 }) || null,
            voiceChannelId: verified.member.voice?.channelId || null,
        },
        instanceId: verified.instanceId || null,
    };
}

module.exports = {
    ActivityApiError,
    readActivityContext,
    serializeContext,
    verifyActivityContext,
};
