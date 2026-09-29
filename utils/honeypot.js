const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { fetchMember } = require('./discord');
const { createEmbed } = require('./embeds');
const { softbanUser } = require('./softban');
const { addUserHistory } = require('./store');

const customIds = {
    softban: userId => `honeypot:softban:${userId}`,
    ban: userId => `honeypot:ban:${userId}`,
    ignore: userId => `honeypot:ignore:${userId}`,
};

function getHoneypotConfig(config = getConfig()) {
    return {
        enabled: config.honeypot?.enabled === true,
        channelId: config.honeypot?.channelId || '',
        alertChannelId: config.honeypot?.alertChannelId || '',
        mentionId: config.honeypot?.mentionId || '',
        mentionType: config.honeypot?.mentionType || '',
    };
}

function createHoneypotButtons(userId, disabled = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customIds.softban(userId))
            .setLabel('Softban')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(customIds.ban(userId))
            .setLabel('Ban')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(customIds.ignore(userId))
            .setLabel('Ignore')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
    )];
}

function buildAlertEmbed(message, deletedCount, status = 'Pending review') {
    return createEmbed({
        title: 'Scam Alert',
        color: 'red',
        fields: [
            { name: 'User', value: `${message.author.tag} (${message.author.id})` },
            { name: 'Honeypot Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Deleted Messages', value: `${deletedCount}`, inline: true },
            { name: 'Status', value: status },
            { name: 'Trigger Message', value: message.content?.slice(0, 1000) || '[No text content]' },
        ],
    });
}

function buildHoneypotNoticeEmbed() {
    return createEmbed({
        title: 'Honeypot Warning',
        description: 'This is to catch scam bots/accounts, typing in here may get you perm banned!',
        color: 'red',
    });
}

async function sendHoneypotNotice(channel) {
    if (!channel?.send) return false;
    await channel.send({
        embeds: [buildHoneypotNoticeEmbed()],
        allowedMentions: { parse: [] },
    });
    return true;
}

function canFetchMessages(channel, botMember) {
    if (!channel?.messages?.fetch || !channel.viewable) return false;
    const permissions = channel.permissionsFor?.(botMember);
    return permissions?.has(PermissionFlagsBits.ViewChannel)
        && permissions?.has(PermissionFlagsBits.ReadMessageHistory)
        && permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function fetchRecentUserMessagesFromGuild(message, perChannelLimit = 25) {
    const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
    const channels = await message.guild.channels.fetch().catch(() => null);
    if (!channels?.size || !botMember) return [];

    const supportedTypes = new Set([
        ChannelType.GuildAnnouncement,
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
    ]);

    const batches = await Promise.allSettled([...channels.values()]
        .filter(channel => supportedTypes.has(channel?.type))
        .filter(channel => canFetchMessages(channel, botMember))
        .map(channel => channel.messages.fetch({ limit: perChannelLimit })));

    const seen = new Map();
    for (const result of batches) {
        if (result.status !== 'fulfilled') continue;
        for (const item of result.value.values()) {
            if (item.author?.id === message.author.id && item.deletable) {
                seen.set(item.id, item);
            }
        }
    }

    if (message.deletable) {
        seen.set(message.id, message);
    }

    return [...seen.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
}

async function deleteRecentUserMessages(message, limit = 10) {
    const deletable = (await fetchRecentUserMessagesFromGuild(message)).slice(0, limit);
    const results = await Promise.allSettled(deletable.map(item => item.delete()));
    return results.filter(result => result.status === 'fulfilled').length;
}

function buildAlertMention(settings) {
    if (!settings.mentionId) return {};
    if (settings.mentionType === 'role') {
        return {
            content: `<@&${settings.mentionId}>`,
            allowedMentions: { roles: [settings.mentionId] },
        };
    }

    return {
        content: `<@${settings.mentionId}>`,
        allowedMentions: { users: [settings.mentionId] },
    };
}

function formatError(error) {
    return error?.message?.slice(0, 250) || 'Discord rejected the action.';
}

async function handleHoneypotMessage(message) {
    const settings = getHoneypotConfig();
    if (!settings.enabled || !message.guild || message.author?.bot || message.channelId !== settings.channelId) {
        return false;
    }

    const deletedCount = await deleteRecentUserMessages(message, 10);
    const alertChannel = await message.client.channels.fetch(settings.alertChannelId).catch(() => null);

    await addUserHistory({
        guildId: message.guild.id,
        userId: message.author.id,
        userTag: message.author.tag,
        type: 'honeypot:trigger',
        summary: `Triggered honeypot. Deleted ${deletedCount} recent messages.`,
        channelId: message.channelId,
        metadata: {
            deletedCount,
            triggerMessage: message.content || '',
        },
    }).catch(error => console.error('Failed to record honeypot history:', error));

    if (alertChannel?.send) {
        await alertChannel.send({
            ...buildAlertMention(settings),
            embeds: [buildAlertEmbed(message, deletedCount)],
            components: createHoneypotButtons(message.author.id),
        });
    }

    return true;
}

async function banUser(guild, userId, reason = 'Scam') {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    await guild.members.ban(userId, { reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
    return user;
}

async function validateHoneypotAction(interaction, userId) {
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
        return { ok: false, message: 'I need Ban Members to use honeypot actions.' };
    }

    if (userId === interaction.guild.ownerId) {
        return { ok: false, message: 'The server owner cannot be moderated.' };
    }

    const member = await fetchMember(interaction.guild, userId);
    if (!member) {
        return { ok: true, member: null };
    }

    if (member.id === interaction.user.id) {
        return { ok: false, member, message: 'You cannot use honeypot actions on yourself.' };
    }

    if (member.roles.highest.position >= botMember.roles.highest.position) {
        return { ok: false, member, message: 'I cannot ban that user because their highest role is above or equal to mine.' };
    }

    if (interaction.guild.ownerId !== interaction.user.id && member.roles.highest.position >= interaction.member.roles.highest.position) {
        return { ok: false, member, message: 'You cannot moderate a user with an equal or higher role.' };
    }

    if (!member.bannable) {
        return { ok: false, member, message: 'I cannot ban that user.' };
    }

    return { ok: true, member };
}

async function updateHoneypotAlert(interaction, userId, action, status, { disabled = false, failed = false } = {}) {
    const existingEmbed = interaction.message.embeds[0];
    const updatedEmbed = createEmbed({
        title: existingEmbed?.title || 'Scam Alert',
        color: failed ? 'orange' : action === 'ignore' ? 'blue' : 'red',
        fields: [
            ...(existingEmbed?.fields || []).filter(field => field.name !== 'Status'),
            { name: 'Status', value: status },
        ],
    });

    return interaction.message.edit({
        embeds: [updatedEmbed],
        components: createHoneypotButtons(userId, disabled),
    });
}

async function handleHoneypotButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('honeypot:') || !interaction.guild) return false;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({ content: 'You need Ban Members to use honeypot actions.', flags: 64 });
        return true;
    }

    const [, action, userId] = interaction.customId.split(':');
    let status;
    let user = await interaction.client.users.fetch(userId).catch(() => null);

    if (!['softban', 'ban', 'ignore'].includes(action)) {
        return false;
    }

    await interaction.deferUpdate();

    try {
        if (action !== 'ignore') {
            const validation = await validateHoneypotAction(interaction, userId);
            if (!validation.ok) {
                throw new Error(validation.message);
            }
        }

        if (action === 'softban') {
            const result = await softbanUser(interaction.guild, userId, { reason: 'Scam' });
            user = result.user;
            status = `Softbanned by ${interaction.user.tag}. Reason: Scam. Invite DM sent: ${result.dmSent ? 'Yes' : 'No'}`;
        } else if (action === 'ban') {
            user = await banUser(interaction.guild, userId);
            status = `Banned by ${interaction.user.tag}. Reason: Scam`;
        } else {
            status = `Ignored by ${interaction.user.tag}.`;
        }

        await addUserHistory({
            guildId: interaction.guild.id,
            userId,
            userTag: user?.tag || userId,
            type: `honeypot:${action}`,
            summary: status,
            channelId: interaction.channelId,
            moderatorId: interaction.user.id,
        });

        await updateHoneypotAlert(interaction, userId, action, status, { disabled: true });
    } catch (error) {
        const actionName = action === 'softban' ? 'Softban' : action === 'ban' ? 'Ban' : 'Ignore';
        status = `${actionName} failed for ${interaction.user.tag}: ${formatError(error)}`;
        await addUserHistory({
            guildId: interaction.guild.id,
            userId,
            userTag: user?.tag || userId,
            type: `honeypot:${action}:failed`,
            summary: status,
            channelId: interaction.channelId,
            moderatorId: interaction.user.id,
        }).catch(historyError => console.error('Failed to record honeypot failure:', historyError));
        await updateHoneypotAlert(interaction, userId, action, status, { disabled: false, failed: true });
    }

    return true;
}

module.exports = {
    buildAlertEmbed,
    buildHoneypotNoticeEmbed,
    createHoneypotButtons,
    customIds,
    deleteRecentUserMessages,
    fetchRecentUserMessagesFromGuild,
    getHoneypotConfig,
    handleHoneypotButton,
    handleHoneypotMessage,
    sendHoneypotNotice,
};
