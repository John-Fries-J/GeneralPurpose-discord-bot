const { ChannelType } = require('discord.js');

function isSendable(channel) {
    return Boolean(channel && typeof channel.send === 'function');
}

function findSendableChannel(guild, channelId, fallbackName) {
    if (!guild) return null;

    const configuredChannel = channelId ? guild.channels.cache.get(channelId) : null;
    if (isSendable(configuredChannel)) return configuredChannel;

    if (!fallbackName) return null;
    return guild.channels.cache.find(channel => channel.name === fallbackName && isSendable(channel)) || null;
}

async function fetchMember(guild, userId) {
    if (!guild || !userId) return null;

    try {
        return await guild.members.fetch(userId);
    } catch {
        return null;
    }
}

async function safeDm(user, payload) {
    try {
        await user.send(payload);
        return true;
    } catch {
        return false;
    }
}

async function safeReply(interaction, payload) {
    try {
        if (interaction.replied) {
            return interaction.followUp(payload);
        }

        if (interaction.deferred) {
            return interaction.editReply(payload);
        }

        return interaction.reply(payload);
    } catch (error) {
        if (error?.code === 10062 || error?.code === 40060) {
            console.warn(`Interaction response skipped: ${error.message}`);
            return null;
        }

        throw error;
    }
}

function truncate(value, maxLength = 1000) {
    const text = value?.toString() || '';
    if (text.length <= maxLength) return text || '[No content]';
    return `${text.slice(0, maxLength - 3)}...`;
}

function isGuildTextChannel(channel) {
    return channel?.type === ChannelType.GuildText && isSendable(channel);
}

module.exports = {
    fetchMember,
    findSendableChannel,
    isGuildTextChannel,
    safeDm,
    safeReply,
    truncate,
};
