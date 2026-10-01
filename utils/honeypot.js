const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
} = require('discord.js');
const { getConfig, updateConfig } = require('./config');
const { fetchMember } = require('./discord');
const { actionRow, button, container, separator, textDisplay, v2Payload } = require('./discordUi');
const { createEmbed } = require('./embeds');
const { softbanUser } = require('./softban');
const {
    addUserHistory,
    beginLimitedAccount,
    getLimitedAccount,
    markLimitedAccountFailed,
    markLimitedAccountRestored,
} = require('./store');

const DEFAULT_TIMEOUT_DURATION_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_DURATION_MS = 28 * 24 * 60 * 60 * 1000;
const HONEYPOT_REASON = 'Scam';

const customIds = {
    limit: userId => `honeypot:limit:${userId}`,
    softban: userId => `honeypot:softban:${userId}`,
    timeout: userId => `honeypot:timeout:${userId}`,
    ban: userId => `honeypot:ban:${userId}`,
    ignore: userId => `honeypot:ignore:${userId}`,
    regainAccess: () => 'honeypot:regain-access',
};

const actionLocks = new Map();
const terminalAlertActions = new Set();

function clampDurationMs(value, fallback = DEFAULT_TIMEOUT_DURATION_MS) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, MAX_TIMEOUT_DURATION_MS);
}

function getHoneypotConfig(config = getConfig()) {
    const honeypot = config.honeypot || {};
    const actions = honeypot.actions || {};
    const limitedAccount = honeypot.limitedAccount || {};

    return {
        enabled: honeypot.enabled === true,
        channelId: honeypot.channelId || '',
        alertChannelId: honeypot.alertChannelId || '',
        mentionId: honeypot.mentionId || '',
        mentionType: honeypot.mentionType || '',
        actions: {
            limit: actions.limit !== false,
            softban: actions.softban !== false,
            timeout: actions.timeout !== false,
            ignore: actions.ignore !== false,
        },
        timeoutDurationMs: clampDurationMs(honeypot.timeoutDurationMs),
        limitedAccount: {
            enabled: limitedAccount.enabled !== false,
            roleId: limitedAccount.roleId || '',
            channelId: limitedAccount.channelId || '',
            panelMessageId: limitedAccount.panelMessageId || '',
            restoreButton: limitedAccount.restoreButton !== false,
            removeExistingRoles: limitedAccount.removeExistingRoles !== false,
        },
    };
}

function createHoneypotButtons(userId, disabled = false, settings = getHoneypotConfig()) {
    const components = [];

    if (settings.actions.limit) {
        components.push(new ButtonBuilder()
            .setCustomId(customIds.limit(userId))
            .setLabel('Limit User')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled));
    }

    if (settings.actions.softban) {
        components.push(new ButtonBuilder()
            .setCustomId(customIds.softban(userId))
            .setLabel('Soft Ban')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled));
    }

    if (settings.actions.timeout) {
        components.push(new ButtonBuilder()
            .setCustomId(customIds.timeout(userId))
            .setLabel('Time Out')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled));
    }

    if (settings.actions.ignore) {
        components.push(new ButtonBuilder()
            .setCustomId(customIds.ignore(userId))
            .setLabel('Ignore')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled));
    }

    return components.length ? [new ActionRowBuilder().addComponents(components)] : [];
}

function buildAlertEmbed(message, deletedCount, review = {}) {
    const details = typeof review === 'string' ? { status: review } : review;
    const author = message.author || {};
    return createEmbed({
        title: 'Scam Alert',
        color: details.failed ? 'orange' : details.action === 'ignore' ? 'blue' : 'red',
        fields: [
            { name: 'Target', value: `<@${author.id}>\n${author.tag || author.id} (${author.id})` },
            { name: 'Trigger Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Messages Deleted', value: `${deletedCount}`, inline: true },
            { name: 'Review Status', value: details.status || 'Pending review', inline: true },
            { name: 'Moderator', value: details.moderator || 'Not reviewed', inline: true },
            { name: 'Action Outcome', value: details.outcome || 'Pending', inline: true },
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

function readEmbedFields(embed) {
    return embed?.fields || embed?.data?.fields || [];
}

function getFieldValue(embed, names, fallback = 'Unknown') {
    const wanted = new Set(names.map(name => name.toLowerCase()));
    const field = readEmbedFields(embed).find(item => wanted.has(String(item.name || '').toLowerCase()));
    return field?.value || fallback;
}

function buildUpdatedAlertEmbed(existingEmbed, userId, details) {
    const target = getFieldValue(existingEmbed, ['Target', 'User'], `<@${userId}> (${userId})`);
    const triggerChannel = getFieldValue(existingEmbed, ['Trigger Channel', 'Honeypot Channel']);
    const deleted = getFieldValue(existingEmbed, ['Messages Deleted', 'Deleted Messages'], 'Unknown');
    const triggerMessage = getFieldValue(existingEmbed, ['Trigger Message'], '[Unavailable]');

    return createEmbed({
        title: existingEmbed?.title || existingEmbed?.data?.title || 'Scam Alert',
        color: details.failed ? 'orange' : details.action === 'ignore' ? 'blue' : 'red',
        fields: [
            { name: 'Target', value: target },
            { name: 'Trigger Channel', value: triggerChannel, inline: true },
            { name: 'Messages Deleted', value: deleted, inline: true },
            { name: 'Review Status', value: details.status, inline: true },
            { name: 'Moderator', value: details.moderator, inline: true },
            { name: 'Action Outcome', value: details.outcome, inline: true },
            { name: 'Trigger Message', value: triggerMessage },
        ],
    });
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
            components: createHoneypotButtons(message.author.id, false, settings),
        });
    }

    return true;
}

async function banUser(guild, userId, reason = HONEYPOT_REASON) {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    await guild.members.ban(userId, { reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
    return user;
}

function memberHasPermission(interaction, permission) {
    if (interaction.guild?.ownerId === interaction.user?.id) return true;
    return interaction.memberPermissions?.has?.(permission) === true
        || interaction.member?.permissions?.has?.(permission) === true;
}

function memberIsHoneypotReviewer(interaction) {
    return [
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.Administrator,
    ].some(permission => memberHasPermission(interaction, permission));
}

function botHasPermission(botMember, permission) {
    return botMember?.permissions?.has?.(permission) === true;
}

async function fetchBotMember(guild) {
    return guild.members.me || await guild.members.fetchMe().catch(() => null);
}

function roleValues(roles) {
    if (!roles) return [];
    if (typeof roles.values === 'function') return [...roles.values()];
    if (roles.cache) return roleValues(roles.cache);
    return Object.values(roles);
}

function getCachedRole(guild, roleId) {
    return guild.roles?.cache?.get?.(roleId) || null;
}

async function fetchRole(guild, roleId) {
    return getCachedRole(guild, roleId) || await guild.roles?.fetch?.(roleId).catch(() => null) || null;
}

function rolePosition(role) {
    return Number(role?.position ?? role?.rawPosition ?? 0);
}

function highestRolePosition(member) {
    return rolePosition(member?.roles?.highest);
}

function roleIsBelowMember(role, member) {
    const highest = member?.roles?.highest;
    if (!role || !highest) return false;
    if (typeof highest.comparePositionTo === 'function') return highest.comparePositionTo(role) > 0;
    return highestRolePosition(member) > rolePosition(role);
}

function targetIsBelowActor(targetMember, actorMember) {
    return highestRolePosition(targetMember) < highestRolePosition(actorMember);
}

function getRoleCache(member) {
    return member?.roles?.cache;
}

function memberHasRole(member, roleId) {
    return getRoleCache(member)?.has?.(roleId) === true;
}

function getRemovableRoleIds(member, botMember, limitedRoleId = '') {
    return roleValues(getRoleCache(member))
        .filter(role => role?.id)
        .filter(role => role.id !== member.guild.id)
        .filter(role => role.id !== limitedRoleId)
        .filter(role => !role.managed)
        .filter(role => roleIsBelowMember(role, botMember))
        .map(role => role.id);
}

function getActionName(action) {
    return {
        ban: 'Ban',
        ignore: 'Ignore',
        limit: 'Limit User',
        softban: 'Soft Ban',
        timeout: 'Time Out',
    }[action] || action;
}

function getModeratorPermissionForAction(action) {
    return {
        ban: PermissionFlagsBits.BanMembers,
        limit: PermissionFlagsBits.ManageRoles,
        softban: PermissionFlagsBits.BanMembers,
        timeout: PermissionFlagsBits.ModerateMembers,
    }[action] || null;
}

function getBotPermissionForAction(action) {
    return {
        ban: PermissionFlagsBits.BanMembers,
        limit: PermissionFlagsBits.ManageRoles,
        softban: PermissionFlagsBits.BanMembers,
        timeout: PermissionFlagsBits.ModerateMembers,
    }[action] || null;
}

function moderatorCanUseHoneypotAction(interaction, action) {
    if (action === 'ignore') return memberIsHoneypotReviewer(interaction);
    const permission = getModeratorPermissionForAction(action);
    return permission ? memberHasPermission(interaction, permission) : false;
}

function ensureModeratorCanUseAction(interaction, action) {
    if (moderatorCanUseHoneypotAction(interaction, action)) return null;
    if (action === 'ignore') return 'You need a moderation permission to ignore honeypot alerts.';

    return {
        [PermissionFlagsBits.ManageRoles]: 'You need Manage Roles to limit a honeypot user.',
        [PermissionFlagsBits.BanMembers]: 'You need Ban Members to soft ban honeypot users.',
        [PermissionFlagsBits.ModerateMembers]: 'You need Moderate Members to time out honeypot users.',
    }[getModeratorPermissionForAction(action)] || 'You do not have permission to use this honeypot action.';
}

async function validateCommonAction(interaction, userId, action, options = {}) {
    const botMember = await fetchBotMember(interaction.guild);
    const botPermission = getBotPermissionForAction(action);

    if (!botMember) return { ok: false, message: 'I could not resolve my server member record.' };
    if (botPermission && !botHasPermission(botMember, botPermission)) {
        return { ok: false, message: `I need ${getActionName(action) === 'Limit User' ? 'Manage Roles' : getActionName(action) === 'Time Out' ? 'Moderate Members' : 'Ban Members'} to use this action.` };
    }

    if (userId === interaction.guild.ownerId) {
        return { ok: false, message: 'The server owner cannot be moderated.' };
    }

    const member = await fetchMember(interaction.guild, userId);
    if (!member) {
        return options.requireMember
            ? { ok: false, member: null, botMember, message: 'That user is not in this server.' }
            : { ok: true, member: null, botMember };
    }

    if (member.id === interaction.user.id) {
        return { ok: false, member, botMember, message: 'You cannot use honeypot actions on yourself.' };
    }

    if (!targetIsBelowActor(member, botMember)) {
        return { ok: false, member, botMember, message: 'I cannot moderate that user because their highest role is above or equal to mine.' };
    }

    if (interaction.guild.ownerId !== interaction.user.id && !targetIsBelowActor(member, interaction.member)) {
        return { ok: false, member, botMember, message: 'You cannot moderate a user with an equal or higher role.' };
    }

    if (options.capability && member[options.capability] !== true) {
        return { ok: false, member, botMember, message: `I cannot ${getActionName(action).toLowerCase()} that user.` };
    }

    return { ok: true, member, botMember };
}

async function validateLimitedAccountSetup(guild, settings = getHoneypotConfig(), options = {}) {
    const diagnostics = [];
    const limited = settings.limitedAccount;
    const botMember = await fetchBotMember(guild);
    const limitedRole = limited.roleId ? await fetchRole(guild, limited.roleId) : null;
    const recoveryChannel = limited.channelId
        ? (guild.channels?.cache?.get?.(limited.channelId) || await guild.channels?.fetch?.(limited.channelId).catch(() => null))
        : null;

    if (!limited.enabled) diagnostics.push('Limited accounts are disabled in honeypot.limitedAccount.enabled.');
    if (!limited.roleId) diagnostics.push('Set a limited account role.');
    if (!limited.channelId) diagnostics.push('Set a limited account recovery channel.');
    if (!botMember) diagnostics.push('The bot member could not be resolved.');
    if (botMember && !botHasPermission(botMember, PermissionFlagsBits.ManageRoles)) diagnostics.push('The bot needs Manage Roles.');

    if (limited.roleId && !limitedRole) diagnostics.push('The configured limited role does not exist.');
    if (limitedRole?.managed) diagnostics.push('The limited role is managed by an integration and cannot be assigned.');
    if (limitedRole?.id === guild.id) diagnostics.push('The limited role cannot be @everyone.');
    if (botMember && limitedRole && !roleIsBelowMember(limitedRole, botMember)) {
        diagnostics.push('Move the bot role above the limited account role.');
    }

    if (limited.channelId && !recoveryChannel) diagnostics.push('The configured recovery channel does not exist or is inaccessible.');
    if (recoveryChannel && botMember) {
        const permissions = recoveryChannel.permissionsFor?.(botMember);
        if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) diagnostics.push('The bot cannot view the recovery channel.');
        if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) diagnostics.push('The bot cannot send messages in the recovery channel.');
        if (!recoveryChannel.send) diagnostics.push('The recovery channel is not sendable.');
    }

    if (limited.restoreButton && options.requirePanel !== false && !limited.panelMessageId) {
        diagnostics.push('Post the recovery panel so limited users can regain access.');
    }

    if (options.targetMember && botMember) {
        const blocked = roleValues(getRoleCache(options.targetMember))
            .filter(role => role?.id && role.id !== guild.id && !role.managed)
            .filter(role => !roleIsBelowMember(role, botMember));
        if (blocked.length) diagnostics.push('The bot cannot manage one or more current target roles.');
    }

    return {
        ok: diagnostics.length === 0,
        diagnostics,
        limitedRole,
        recoveryChannel,
        botMember,
    };
}

async function validateLimitAction(interaction, userId, settings) {
    const common = await validateCommonAction(interaction, userId, 'limit', { requireMember: true });
    if (!common.ok) return common;

    const setup = await validateLimitedAccountSetup(interaction.guild, settings, {
        requirePanel: false,
        targetMember: common.member,
    });
    if (!setup.ok) {
        return { ok: false, member: common.member, botMember: common.botMember, message: setup.diagnostics.join(' ') };
    }

    const existing = await getLimitedAccount(interaction.guild.id, userId);
    if (existing?.status === 'active') {
        return { ok: false, member: common.member, botMember: common.botMember, message: 'That user is already limited.' };
    }

    if (memberHasRole(common.member, setup.limitedRole.id)) {
        return { ok: false, member: common.member, botMember: common.botMember, message: 'That user already has the limited role but has no active recovery record.' };
    }

    return {
        ok: true,
        member: common.member,
        botMember: common.botMember,
        limitedRole: setup.limitedRole,
    };
}

async function recordHoneypotHistory(interaction, userId, userTag, action, summary, metadata = {}) {
    return addUserHistory({
        guildId: interaction.guild.id,
        userId,
        userTag: userTag || userId,
        type: `honeypot:${action}`,
        summary,
        channelId: interaction.channelId,
        moderatorId: interaction.user.id,
        metadata,
    });
}

async function rollbackLimitedMutation(member, limitedRoleId, previousRoleIds) {
    const botMember = await fetchBotMember(member.guild);
    const restorable = previousRoleIds
        .map(roleId => getCachedRole(member.guild, roleId))
        .filter(role => role && !role.managed && roleIsBelowMember(role, botMember))
        .map(role => role.id);

    if (restorable.length) await member.roles.add(restorable, 'Rolling back failed honeypot limit');
    await member.roles.remove(limitedRoleId, 'Rolling back failed honeypot limit');
}

async function limitHoneypotUser(interaction, userId, settings = getHoneypotConfig()) {
    const validation = await validateLimitAction(interaction, userId, settings);
    if (!validation.ok) throw new Error(validation.message);

    const previousRoleIds = getRemovableRoleIds(validation.member, validation.botMember, validation.limitedRole.id);
    const roleIdsToRemove = settings.limitedAccount.removeExistingRoles ? previousRoleIds : [];
    const begin = await beginLimitedAccount({
        guildId: interaction.guild.id,
        userId,
        previousRoleIds,
        limitedRoleId: validation.limitedRole.id,
        limitedChannelId: settings.limitedAccount.channelId,
        limitedBy: interaction.user.id,
        limitedAt: Date.now(),
    });

    if (!begin.ok) throw new Error('That user is already limited.');

    try {
        if (!memberHasRole(validation.member, validation.limitedRole.id)) {
            await validation.member.roles.add(validation.limitedRole.id, HONEYPOT_REASON);
        }
        if (roleIdsToRemove.length) {
            await validation.member.roles.remove(roleIdsToRemove, 'Honeypot limited account');
        }
    } catch (error) {
        try {
            await rollbackLimitedMutation(validation.member, validation.limitedRole.id, previousRoleIds);
            await markLimitedAccountFailed(interaction.guild.id, userId, { source: 'limit_role_mutation_failed' });
        } catch {
            // Leave the active record in place so the persisted snapshot can still be recovered.
        }
        throw error;
    }

    const summary = `Limited by ${interaction.user.tag}. Removed ${roleIdsToRemove.length} role(s).`;
    await recordHoneypotHistory(interaction, userId, validation.member.user?.tag || userId, 'limit', summary, {
        previousRoleIds,
        limitedRoleId: validation.limitedRole.id,
        removedRoleCount: roleIdsToRemove.length,
    });

    return {
        user: validation.member.user,
        outcome: summary,
        metadata: { removedRoleCount: roleIdsToRemove.length },
    };
}

async function softbanHoneypotUser(interaction, userId) {
    const validation = await validateCommonAction(interaction, userId, 'softban', {
        capability: 'bannable',
        requireMember: false,
    });
    if (!validation.ok) throw new Error(validation.message);

    const result = await softbanUser(interaction.guild, userId, { reason: HONEYPOT_REASON });
    const summary = `Soft banned by ${interaction.user.tag}. Reason: ${HONEYPOT_REASON}. Invite DM sent: ${result.dmSent ? 'Yes' : 'No'}.`;
    await recordHoneypotHistory(interaction, userId, result.user?.tag || userId, 'softban', summary, {
        dmSent: result.dmSent,
    });
    return { user: result.user, outcome: summary };
}

async function banHoneypotUser(interaction, userId) {
    const validation = await validateCommonAction(interaction, userId, 'ban', {
        capability: 'bannable',
        requireMember: false,
    });
    if (!validation.ok) throw new Error(validation.message);

    const user = await banUser(interaction.guild, userId);
    const summary = `Banned by ${interaction.user.tag}. Reason: ${HONEYPOT_REASON}.`;
    await recordHoneypotHistory(interaction, userId, user?.tag || userId, 'ban', summary);
    return { user, outcome: summary };
}

async function timeoutHoneypotUser(interaction, userId, settings = getHoneypotConfig()) {
    const validation = await validateCommonAction(interaction, userId, 'timeout', {
        capability: 'moderatable',
        requireMember: true,
    });
    if (!validation.ok) throw new Error(validation.message);

    const durationMs = clampDurationMs(settings.timeoutDurationMs);
    if (typeof validation.member.timeout === 'function') {
        await validation.member.timeout(durationMs, HONEYPOT_REASON);
    } else if (typeof validation.member.disableCommunicationUntil === 'function') {
        await validation.member.disableCommunicationUntil(new Date(Date.now() + durationMs), HONEYPOT_REASON);
    } else {
        throw new Error('This member object does not support Discord timeouts.');
    }

    const summary = `Timed out by ${interaction.user.tag} for ${Math.round(durationMs / 60000)} minute(s). Reason: ${HONEYPOT_REASON}.`;
    await recordHoneypotHistory(interaction, userId, validation.member.user?.tag || userId, 'timeout', summary, {
        durationMs,
        expiresAt: Date.now() + durationMs,
    });
    return { user: validation.member.user, outcome: summary };
}

async function ignoreHoneypotUser(interaction, userId, user = null) {
    const summary = `Ignored by ${interaction.user.tag}.`;
    await recordHoneypotHistory(interaction, userId, user?.tag || userId, 'ignore', summary);
    return { user, outcome: summary };
}

async function updateHoneypotAlert(interaction, userId, action, outcome, { disabled = false, failed = false } = {}) {
    const existingEmbed = interaction.message.embeds?.[0];
    const updatedEmbed = buildUpdatedAlertEmbed(existingEmbed, userId, {
        action,
        failed,
        status: failed ? `${getActionName(action)} failed` : action === 'ignore' ? 'Ignored' : 'Action completed',
        moderator: `${interaction.user.tag} (${interaction.user.id})`,
        outcome,
    });

    return interaction.message.edit({
        embeds: [updatedEmbed],
        components: createHoneypotButtons(userId, disabled),
    });
}

async function withActionLock(key, run) {
    while (actionLocks.has(key)) {
        await actionLocks.get(key).catch(() => null);
    }

    const current = Promise.resolve().then(run);
    actionLocks.set(key, current);
    try {
        return await current;
    } finally {
        if (actionLocks.get(key) === current) actionLocks.delete(key);
    }
}

function alertLockKey(interaction, userId) {
    return `${interaction.guild.id}:${interaction.message?.id || interaction.id || 'unknown'}:${userId}`;
}

async function runHoneypotAction(interaction, action, userId) {
    const permissionError = ensureModeratorCanUseAction(interaction, action);
    if (permissionError) {
        await interaction.reply({ content: permissionError, flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferUpdate();

    const key = alertLockKey(interaction, userId);
    return withActionLock(key, async () => {
        if (terminalAlertActions.has(key)) return true;

        const settings = getHoneypotConfig();
        let fetchedUser = await interaction.client?.users?.fetch?.(userId).catch(() => null);

        try {
            let result;
            if (action === 'limit') {
                result = await limitHoneypotUser(interaction, userId, settings);
            } else if (action === 'softban') {
                result = await softbanHoneypotUser(interaction, userId);
            } else if (action === 'timeout') {
                result = await timeoutHoneypotUser(interaction, userId, settings);
            } else if (action === 'ban') {
                result = await banHoneypotUser(interaction, userId);
            } else {
                result = await ignoreHoneypotUser(interaction, userId, fetchedUser);
            }

            fetchedUser = result.user || fetchedUser;
            terminalAlertActions.add(key);
            await updateHoneypotAlert(interaction, userId, action, result.outcome, { disabled: true });
        } catch (error) {
            const outcome = `${getActionName(action)} failed for ${interaction.user.tag}: ${formatError(error)}`;
            await addUserHistory({
                guildId: interaction.guild.id,
                userId,
                userTag: fetchedUser?.tag || userId,
                type: `honeypot:${action}:failed`,
                summary: outcome,
                channelId: interaction.channelId,
                moderatorId: interaction.user.id,
            }).catch(historyError => console.error('Failed to record honeypot failure:', historyError));
            await updateHoneypotAlert(interaction, userId, action, outcome, { disabled: false, failed: true });
        }

        return true;
    });
}

function filterRestorableRoleIds(guild, botMember, roleIds = []) {
    return [...new Set(roleIds)]
        .map(roleId => getCachedRole(guild, roleId))
        .filter(role => role && role.id !== guild.id && !role.managed && roleIsBelowMember(role, botMember))
        .map(role => role.id);
}

async function restoreLimitedAccount(interaction, source = 'self_service') {
    const record = await getLimitedAccount(interaction.guild.id, interaction.user.id);
    if (!record) return { ok: false, message: 'Your account is not currently limited.' };
    if (record.userId !== interaction.user.id) return { ok: false, message: 'You can only restore your own account.' };
    if (record.status === 'restored') return { ok: true, alreadyRestored: true, message: 'Your access has already been restored.' };
    if (record.status !== 'active') return { ok: false, message: 'Your limited account record is not active. Contact staff if you still need help.' };

    const member = await fetchMember(interaction.guild, interaction.user.id);
    if (!member) return { ok: false, message: 'I could not find your server member record.' };

    const botMember = await fetchBotMember(interaction.guild);
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        return { ok: false, message: 'I need Manage Roles before I can restore access.' };
    }

    const restorableRoleIds = filterRestorableRoleIds(interaction.guild, botMember, record.previousRoleIds);
    if (restorableRoleIds.length) {
        await member.roles.add(restorableRoleIds, 'Honeypot limited account recovery');
    }

    if (record.limitedRoleId && memberHasRole(member, record.limitedRoleId)) {
        await member.roles.remove(record.limitedRoleId, 'Honeypot limited account recovery');
    }

    await markLimitedAccountRestored(interaction.guild.id, interaction.user.id, {
        restoredBy: interaction.user.id,
        restoredAt: Date.now(),
        restorationSource: source,
    });

    await addUserHistory({
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        type: 'honeypot:restore',
        summary: `Limited account restored by ${source}. Restored ${restorableRoleIds.length} role(s).`,
        channelId: interaction.channelId,
        moderatorId: interaction.user.id,
        metadata: {
            restoredRoleIds: restorableRoleIds,
            limitedRoleId: record.limitedRoleId,
            source,
        },
    });

    return {
        ok: true,
        restoredRoleIds: restorableRoleIds,
        message: `Your access has been restored. Restored ${restorableRoleIds.length} role(s).`,
    };
}

async function handleLimitedAccountRecoveryButton(interaction) {
    if (interaction.customId !== customIds.regainAccess()) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const result = await restoreLimitedAccount(interaction, 'self_service');
        await interaction.editReply({ content: result.message });
    } catch (error) {
        await interaction.editReply({ content: `I could not restore your access: ${formatError(error)}` });
    }
    return true;
}

function buildLimitedAccountRecoveryPanelPayload() {
    return {
        ...v2Payload(container([
            textDisplay('## Account Limited'),
            textDisplay('Your account has been limited.'),
            separator(),
            actionRow(button(customIds.regainAccess(), 'Regain Access', ButtonStyle.Primary)),
        ], { accentColor: 0xf0b232 }), { ephemeral: false }),
        allowedMentions: { parse: [] },
    };
}

async function postOrRefreshLimitedAccountRecoveryPanel(guild, settings = getHoneypotConfig()) {
    if (!settings.limitedAccount.channelId) {
        return { ok: false, message: 'Configure a limited account recovery channel first.' };
    }

    const channel = guild.channels?.cache?.get?.(settings.limitedAccount.channelId)
        || await guild.channels?.fetch?.(settings.limitedAccount.channelId).catch(() => null);
    if (!channel?.send) {
        return { ok: false, message: 'I could not access the configured recovery channel.' };
    }

    const payload = buildLimitedAccountRecoveryPanelPayload();
    let panelMessage = null;
    let action = 'posted';

    if (settings.limitedAccount.panelMessageId && channel.messages?.fetch) {
        panelMessage = await channel.messages.fetch(settings.limitedAccount.panelMessageId).catch(() => null);
        if (panelMessage?.edit) {
            await panelMessage.edit(payload);
            action = 'updated';
        }
    }

    if (!panelMessage) {
        panelMessage = await channel.send(payload);
    }

    updateConfig(config => {
        config.honeypot ||= {};
        config.honeypot.limitedAccount ||= {};
        config.honeypot.limitedAccount.panelMessageId = panelMessage.id;
        return config;
    });

    return {
        ok: true,
        action,
        channelId: channel.id,
        messageId: panelMessage.id,
    };
}

async function handleHoneypotButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('honeypot:') || !interaction.guild) return false;

    if (await handleLimitedAccountRecoveryButton(interaction)) return true;

    const [, action, userId] = interaction.customId.split(':');
    if (!['limit', 'softban', 'timeout', 'ban', 'ignore'].includes(action) || !userId) {
        return false;
    }

    return runHoneypotAction(interaction, action, userId);
}

module.exports = {
    DEFAULT_TIMEOUT_DURATION_MS,
    MAX_TIMEOUT_DURATION_MS,
    buildAlertEmbed,
    buildHoneypotNoticeEmbed,
    buildLimitedAccountRecoveryPanelPayload,
    createHoneypotButtons,
    customIds,
    deleteRecentUserMessages,
    fetchRecentUserMessagesFromGuild,
    filterRestorableRoleIds,
    getHoneypotConfig,
    getRemovableRoleIds,
    handleHoneypotButton,
    handleHoneypotMessage,
    limitHoneypotUser,
    moderatorCanUseHoneypotAction,
    postOrRefreshLimitedAccountRecoveryPanel,
    restoreLimitedAccount,
    sendHoneypotNotice,
    timeoutHoneypotUser,
    updateHoneypotAlert,
    validateLimitedAccountSetup,
};
