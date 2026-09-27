const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { getTempVoiceChannel, removeTempVoiceChannel, upsertTempVoiceChannel } = require('./store');

function getJoinToCreateConfig(config = getConfig()) {
    return {
        enabled: config.joinToCreate?.enabled === true,
        triggerChannelId: config.joinToCreate?.triggerChannelId || '',
        categoryId: config.joinToCreate?.categoryId || '',
        nameFormat: config.joinToCreate?.nameFormat || "{username}'s Channel",
        userLimitMax: Number(config.joinToCreate?.userLimitMax || 25),
    };
}

function formatVoiceChannelName(template, member) {
    return template
        .replaceAll('{username}', member.user.username)
        .replaceAll('{displayName}', member.displayName)
        .slice(0, 100);
}

async function handleJoinToCreate(oldState, newState) {
    const settings = getJoinToCreateConfig();
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
            createdAt: Date.now(),
        });
        await newState.setChannel(channel, 'Moving user to join-to-create channel').catch(() => null);
        return;
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const record = await getTempVoiceChannel(oldState.channelId);
        if (!record) return;

        const oldChannel = oldState.guild.channels.cache.get(oldState.channelId) || await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);
        if (oldChannel && oldChannel.members.size === 0) {
            await removeTempVoiceChannel(oldState.channelId);
            await oldChannel.delete('Deleting empty join-to-create channel').catch(() => null);
        }
    }
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
    formatVoiceChannelName,
    getJoinToCreateConfig,
    getOwnedVoiceChannel,
    handleJoinToCreate,
};
