const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { getTempVoiceChannel, listTempVoiceChannelsForGuild, removeTempVoiceChannel, upsertTempVoiceChannel } = require('./store');

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
        await sendJoinToCreateIntro(channel, newState.member);
        return;
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const record = await getTempVoiceChannel(oldState.channelId);
        if (!record) return;

        const oldChannel = oldState.guild.channels.cache.get(oldState.channelId) || await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);
        if (oldChannel && oldChannel.members.size === 0) {
            await removeTempVoiceChannel(oldState.channelId);
            await oldChannel.delete('Deleting empty join-to-create channel').catch(() => null);
        } else if (oldChannel && record.ownerId === oldState.member?.id) {
            const nextOwner = oldChannel.members.find(member => !member.user.bot);
            if (nextOwner) {
                await upsertTempVoiceChannel({
                    ...record,
                    ownerId: nextOwner.id,
                    transferredAt: Date.now(),
                });
                await oldChannel.permissionOverwrites.edit(nextOwner.id, {
                    Connect: true,
                    ManageChannels: true,
                    MoveMembers: true,
                    ViewChannel: true,
                }).catch(() => null);
                await oldChannel.send?.(`<@${nextOwner.id}> is now the temporary voice channel owner.`).catch(() => null);
            }
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
    deleteJoinToCreateChannels,
    formatVoiceChannelName,
    getJoinToCreateConfig,
    getOwnedVoiceChannel,
    handleJoinToCreate,
};
