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
const { logger } = require('./logger');
const { softbanUser } = require('./softban');
const {
    addUserHistory,
    beginLimitedAccount,
    getLimitedAccount,
    listGuildHistory,
    markLimitedAccountFailed,
    markLimitedAccountRestored,
} = require('./store');

const DEFAULT_TIMEOUT_DURATION_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_DURATION_MS = 28 * 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_DELAY_MS = 3000;
const MAX_CLEANUP_DELAY_MS = 60 * 1000;
const HONEYPOT_CLEANUP_LIMIT = 15;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CLEANUP_RESUME_WINDOW_MS = 60 * 1000;
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
const cleanupJobs = new Map();
const terminalAlertActions = new Set();
const honeypotLogger = logger.child({ component: 'honeypot' });

function clampDurationMs(value, fallback = DEFAULT_TIMEOUT_DURATION_MS) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, MAX_TIMEOUT_DURATION_MS);
}

function clampCleanupDelayMs(value, fallback = DEFAULT_CLEANUP_DELAY_MS) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) return fallback;
    return Math.min(number, MAX_CLEANUP_DELAY_MS);
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
        cleanupDelayMs: clampCleanupDelayMs(honeypot.cleanupDelayMs),
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
        && permissions?.has(PermissionFlagsBits.ReadMessageHistory);
}

function canBulkDeleteMessages(channel, botMember) {
    if (!channel?.bulkDelete) return false;
    const permissions = channel.permissionsFor?.(botMember);
    return permissions?.has(PermissionFlagsBits.ManageMessages) === true;
}

function contextUserId(context) {
    return context.userId || context.author?.id || context.user?.id || null;
}

function contextUserTag(context) {
    return context.userTag || context.author?.tag || context.user?.tag || contextUserId(context);
}

function isSupportedCleanupChannel(channel) {
    return new Set([
        ChannelType.AnnouncementThread,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
    ]).has(channel?.type);
}

function channelCollectionValues(channels) {
    if (!channels) return [];
    if (typeof channels.values === 'function') return [...channels.values()];
    return Object.values(channels);
}

function addCleanupEntry(entries, message, channel, userId) {
    if (!message?.id || message.author?.id !== userId) return;
    entries.set(message.id, {
        id: message.id,
        message,
        channel: message.channel || channel,
        createdTimestamp: Number(message.createdTimestamp || 0),
    });
}

async function fetchRecentUserMessageEntriesFromGuild(context, perChannelLimit = 25) {
    const userId = contextUserId(context);
    const guild = context.guild;
    const failures = [];
    if (!guild || !userId) return { entries: [], failures: [{ scope: 'guild', reason: 'missing_context' }] };

    const botMember = guild.members?.me || await guild.members?.fetchMe?.().catch(error => {
        failures.push({ scope: 'guild', reason: 'fetch_bot_member_failed', error: formatError(error) });
        return null;
    });
    const fetchedChannels = await guild.channels?.fetch?.().catch(error => {
        failures.push({ scope: 'guild', reason: 'fetch_channels_failed', error: formatError(error) });
        return null;
    });
    const channels = fetchedChannels || guild.channels?.cache;
    if (!botMember) return { entries: [], failures };

    const entries = new Map();
    const fetches = channelCollectionValues(channels)
        .filter(isSupportedCleanupChannel)
        .filter(channel => canFetchMessages(channel, botMember))
        .map(async channel => {
            try {
                const messages = await channel.messages.fetch({ limit: perChannelLimit });
                for (const item of messages.values()) addCleanupEntry(entries, item, channel, userId);
            } catch (error) {
                failures.push({ scope: 'channel', channelId: channel.id, reason: 'fetch_messages_failed', error: formatError(error) });
            }
        });
    await Promise.all(fetches);

    for (const item of context.extraMessages?.values?.() || []) {
        addCleanupEntry(entries, item, item.channel || context.channel, userId);
    }
    addCleanupEntry(entries, context, context.channel, userId);

    return {
        entries: [...entries.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp),
        failures,
    };
}

async function fetchRecentUserMessagesFromGuild(context, perChannelLimit = 25) {
    const { entries } = await fetchRecentUserMessageEntriesFromGuild(context, perChannelLimit);
    return entries.map(entry => entry.message);
}

function isUnknownDeletedMessage(error) {
    return error?.code === 10008;
}

function cleanupFailure(scope, entry, reason, error = null) {
    return {
        scope,
        channelId: entry?.channel?.id || null,
        messageId: entry?.id || null,
        reason,
        error: error ? formatError(error) : null,
    };
}

function isRecentEnoughForBulkDelete(entry, now = Date.now()) {
    return entry.createdTimestamp > 0 && now - entry.createdTimestamp < BULK_DELETE_MAX_AGE_MS;
}

async function deleteEntryIndividually(entry) {
    const message = entry.message;
    if (message.deletable === false || typeof message.delete !== 'function') {
        return { deleted: 0, failures: [cleanupFailure('message', entry, 'not_deletable')] };
    }

    try {
        await message.delete();
        return { deleted: 1, failures: [] };
    } catch (error) {
        if (isUnknownDeletedMessage(error)) return { deleted: 0, failures: [] };
        return { deleted: 0, failures: [cleanupFailure('message', entry, 'delete_failed', error)] };
    }
}

async function deleteBulkEntries(channel, entries) {
    try {
        const deleted = await channel.bulkDelete(entries.map(entry => entry.message), true);
        const deletedIds = new Set(deleted?.keys ? [...deleted.keys()] : entries.map(entry => entry.id));
        return {
            deleted: typeof deleted?.size === 'number' ? deleted.size : deletedIds.size,
            deletedIds,
            failures: [],
        };
    } catch (error) {
        return {
            deleted: 0,
            deletedIds: new Set(),
            failures: entries.map(entry => cleanupFailure('message', entry, 'bulk_delete_failed', error)),
        };
    }
}

async function deleteRecentUserMessagesWithReport(context, limit = HONEYPOT_CLEANUP_LIMIT, options = {}) {
    const userId = contextUserId(context);
    const botMember = context.guild?.members?.me || await context.guild?.members?.fetchMe?.().catch(() => null);
    const seenIds = options.seenIds || new Set();
    const { entries, failures } = await fetchRecentUserMessageEntriesFromGuild(context, 25);
    const candidates = entries
        .filter(entry => entry.message?.author?.id === userId)
        .filter(entry => !seenIds.has(entry.id))
        .slice(0, limit);

    for (const entry of candidates) seenIds.add(entry.id);

    let deletedCount = 0;
    const deleteFailures = [...failures];
    const byChannel = new Map();
    for (const entry of candidates) {
        const channelId = entry.channel?.id || 'unknown';
        if (!byChannel.has(channelId)) byChannel.set(channelId, { channel: entry.channel, entries: [] });
        byChannel.get(channelId).entries.push(entry);
    }

    for (const { channel, entries: channelEntries } of byChannel.values()) {
        const recentBulkEntries = channelEntries.filter(entry => isRecentEnoughForBulkDelete(entry));
        const individualEntries = channelEntries.filter(entry => !recentBulkEntries.includes(entry));

        if (recentBulkEntries.length > 1 && canBulkDeleteMessages(channel, botMember)) {
            const bulk = await deleteBulkEntries(channel, recentBulkEntries);
            deletedCount += bulk.deleted;
            deleteFailures.push(...bulk.failures);
            individualEntries.push(...recentBulkEntries.filter(entry => !bulk.deletedIds.has(entry.id)));
        } else {
            individualEntries.push(...recentBulkEntries);
        }

        for (const entry of individualEntries) {
            const result = await deleteEntryIndividually(entry);
            deletedCount += result.deleted;
            deleteFailures.push(...result.failures);
        }
    }

    return {
        deletedCount,
        failures: deleteFailures,
        consideredCount: candidates.length,
        seenIds,
    };
}

async function deleteRecentUserMessages(context, limit = HONEYPOT_CLEANUP_LIMIT) {
    const result = await deleteRecentUserMessagesWithReport(context, limit);
    return result.deletedCount;
}

function cleanupJobKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function cleanupIdFor(message) {
    return `${message.guild.id}:${message.author.id}:${message.id}`;
}

function waitForCleanupDelay(delayMs) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, delayMs);
        timer.unref?.();
    });
}

function cleanupContextFromState(state) {
    return {
        guild: state.guild,
        userId: state.userId,
        userTag: state.userTag,
        channelId: state.channelId,
        extraMessages: state.extraMessages,
    };
}

async function recordCleanupMarker(state, type, metadata = {}) {
    await addUserHistory({
        guildId: state.guild.id,
        userId: state.userId,
        userTag: state.userTag,
        type,
        summary: metadata.summary || type,
        channelId: state.channelId,
        metadata: {
            cleanupId: state.cleanupId,
            ...metadata,
        },
    }).catch(error => {
        honeypotLogger.warn('Failed to record honeypot cleanup marker', {
            guildId: state.guild.id,
            userId: state.userId,
            type,
            error,
        });
    });
}

async function runCleanupPass(state, phase) {
    const result = await deleteRecentUserMessagesWithReport(cleanupContextFromState(state), HONEYPOT_CLEANUP_LIMIT, {
        seenIds: state.seenIds,
    });
    state.deletedCount += result.deletedCount;
    state.failures.push(...result.failures);

    honeypotLogger.info('Honeypot cleanup pass finished', {
        guildId: state.guild.id,
        userId: state.userId,
        cleanupId: state.cleanupId,
        phase,
        deletedCount: result.deletedCount,
        consideredCount: result.consideredCount,
        failureCount: result.failures.length,
    });

    if (result.failures.length) {
        honeypotLogger.warn('Honeypot cleanup pass had failures', {
            guildId: state.guild.id,
            userId: state.userId,
            cleanupId: state.cleanupId,
            phase,
            failures: result.failures.slice(0, 10),
        });
    }

    return result;
}

function startHoneypotCleanupJob(message, settings = getHoneypotConfig(), options = {}) {
    const userId = contextUserId(message);
    if (!message.guild || !userId) {
        const empty = Promise.resolve({ deletedCount: 0, failures: [], consideredCount: 0, seenIds: new Set() });
        return { firstPass: empty, done: empty };
    }

    const key = cleanupJobKey(message.guild.id, userId);
    const existing = cleanupJobs.get(key);
    if (existing) {
        if (message.id) existing.state.extraMessages.set(message.id, message);
        return { ...existing, existing: true };
    }

    const delayMs = clampCleanupDelayMs(settings.cleanupDelayMs);
    const state = {
        cleanupId: options.cleanupId || cleanupIdFor(message),
        guild: message.guild,
        userId,
        userTag: contextUserTag(message),
        channelId: message.channelId || message.channel?.id || null,
        extraMessages: new Map(message.id ? [[message.id, message]] : []),
        seenIds: new Set(),
        deletedCount: 0,
        failures: [],
    };
    const dueAt = options.dueAt || Date.now() + delayMs;
    const firstPass = options.skipImmediate
        ? Promise.resolve({ deletedCount: 0, failures: [], consideredCount: 0, seenIds: state.seenIds })
        : runCleanupPass(state, 'immediate');
    const job = {
        state,
        firstPass,
        existing: false,
        done: (async () => {
            if (options.recordPending !== false) {
                await recordCleanupMarker(state, 'honeypot:cleanup:pending', {
                    summary: 'Honeypot cleanup pending second pass.',
                    dueAt,
                    delayMs,
                });
            }
            await firstPass.catch(() => null);
            await waitForCleanupDelay(Math.max(0, dueAt - Date.now()));
            await runCleanupPass(state, 'delayed').catch(error => {
                state.failures.push({ scope: 'job', reason: 'delayed_pass_failed', error: formatError(error) });
                honeypotLogger.warn('Honeypot delayed cleanup failed', {
                    guildId: state.guild.id,
                    userId: state.userId,
                    cleanupId: state.cleanupId,
                    error,
                });
            });
            await recordCleanupMarker(state, 'honeypot:cleanup:completed', {
                summary: `Honeypot cleanup completed. Deleted ${state.deletedCount} message(s).`,
                deletedCount: state.deletedCount,
                failureCount: state.failures.length,
                failures: state.failures.slice(0, 10),
            });
            honeypotLogger.info('Honeypot cleanup job completed', {
                guildId: state.guild.id,
                userId: state.userId,
                cleanupId: state.cleanupId,
                deletedCount: state.deletedCount,
                failureCount: state.failures.length,
            });
            return state;
        })().finally(() => {
            if (cleanupJobs.get(key)?.state === state) cleanupJobs.delete(key);
        }),
    };

    cleanupJobs.set(key, job);
    return job;
}

async function resumeHoneypotCleanupJobs(client) {
    const guilds = channelCollectionValues(client.guilds?.cache);
    const settings = getHoneypotConfig();
    const now = Date.now();
    let resumed = 0;

    for (const guild of guilds) {
        const history = await listGuildHistory(guild.id, 200).catch(error => {
            honeypotLogger.warn('Failed to inspect honeypot cleanup history for resume', {
                guildId: guild.id,
                error,
            });
            return [];
        });
        const completed = new Set(history
            .filter(entry => entry.type === 'honeypot:cleanup:completed')
            .map(entry => entry.metadata?.cleanupId)
            .filter(Boolean));
        const pending = history
            .filter(entry => entry.type === 'honeypot:cleanup:pending')
            .filter(entry => entry.metadata?.cleanupId && !completed.has(entry.metadata.cleanupId))
            .filter(entry => Number(entry.metadata?.dueAt || 0) + CLEANUP_RESUME_WINDOW_MS >= now)
            .sort((a, b) => Number(a.metadata?.dueAt || 0) - Number(b.metadata?.dueAt || 0));

        for (const entry of pending) {
            const job = startHoneypotCleanupJob({
                guild,
                userId: entry.userId,
                userTag: entry.userTag,
                channelId: entry.channelId,
            }, settings, {
                cleanupId: entry.metadata.cleanupId,
                dueAt: Number(entry.metadata.dueAt || now),
                recordPending: false,
                skipImmediate: true,
            });
            if (!job.existing) resumed += 1;
        }
    }

    if (resumed) honeypotLogger.info('Resumed pending honeypot cleanup jobs', { resumed });
    return resumed;
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

    const cleanupJob = startHoneypotCleanupJob(message, settings);
    if (cleanupJob.existing) return true;

    const [cleanupResult, actionResult] = await Promise.all([
        cleanupJob.firstPass.catch(error => {
            honeypotLogger.warn('Immediate honeypot cleanup failed', {
                guildId: message.guild.id,
                userId: message.author.id,
                error,
            });
            return { deletedCount: 0, failures: [{ scope: 'job', reason: 'immediate_pass_failed', error: formatError(error) }] };
        }),
        runAutomaticHoneypotAction(message, settings),
    ]);
    const deletedCount = cleanupResult.deletedCount || 0;
    const alertChannel = await message.client.channels.fetch(settings.alertChannelId).catch(() => null);
    const review = actionResult?.action
        ? {
            action: actionResult.action,
            failed: !actionResult.ok,
            status: actionResult.ok ? 'Automatic action completed' : `${getActionName(actionResult.action)} failed`,
            moderator: message.client.user ? `${message.client.user.tag} (${message.client.user.id})` : 'Bot automation',
            outcome: actionResult.outcome,
        }
        : {};

    await addUserHistory({
        guildId: message.guild.id,
        userId: message.author.id,
        userTag: message.author.tag,
        type: 'honeypot:trigger',
        summary: `Triggered honeypot. Deleted ${deletedCount} recent message(s) immediately.`,
        channelId: message.channelId,
        metadata: {
            deletedCount,
            cleanupDelayMs: settings.cleanupDelayMs,
            cleanupDueAt: Date.now() + settings.cleanupDelayMs,
            cleanupFailureCount: cleanupResult.failures?.length || 0,
            action: actionResult?.action || null,
            actionOk: actionResult?.ok === true,
            triggerMessage: message.content || '',
        },
    }).catch(error => console.error('Failed to record honeypot history:', error));

    if (alertChannel?.send) {
        await alertChannel.send({
            ...buildAlertMention(settings),
            embeds: [buildAlertEmbed(message, deletedCount, review)],
            components: createHoneypotButtons(message.author.id, actionResult?.ok === true, settings),
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

function getConfiguredAutoAction(settings) {
    return ['limit', 'softban', 'timeout'].find(action => settings.actions[action]) || null;
}

async function runAutomaticHoneypotAction(message, settings = getHoneypotConfig()) {
    const action = getConfiguredAutoAction(settings);
    if (!action) return { action: null, ok: false, outcome: 'No moderation action is enabled.' };

    const userId = message.author.id;
    const key = `auto:${message.guild.id}:${userId}:${action}`;
    return withActionLock(key, async () => {
        const botMember = await fetchBotMember(message.guild);
        const botUser = botMember?.user || message.client?.user || { id: message.client?.user?.id || 'bot', tag: 'Bot' };
        const interaction = {
            guild: message.guild,
            guildId: message.guild.id,
            channelId: message.channelId,
            client: message.client || message.guild.client,
            user: botUser,
            member: botMember,
            memberPermissions: botMember?.permissions,
        };

        try {
            let result;
            if (action === 'limit') {
                result = await limitHoneypotUser(interaction, userId, settings);
            } else if (action === 'softban') {
                result = await softbanHoneypotUser(interaction, userId);
            } else {
                result = await timeoutHoneypotUser(interaction, userId, settings);
            }

            honeypotLogger.info('Automatic honeypot action completed', {
                guildId: message.guild.id,
                userId,
                action,
            });
            return { action, ok: true, user: result.user, outcome: result.outcome };
        } catch (error) {
            const outcome = `${getActionName(action)} failed automatically: ${formatError(error)}`;
            await addUserHistory({
                guildId: message.guild.id,
                userId,
                userTag: message.author.tag,
                type: `honeypot:${action}:failed`,
                summary: outcome,
                channelId: message.channelId,
                moderatorId: botUser.id,
            }).catch(historyError => honeypotLogger.warn('Failed to record automatic honeypot action failure', {
                guildId: message.guild.id,
                userId,
                action,
                error: historyError,
            }));
            honeypotLogger.warn('Automatic honeypot action failed', {
                guildId: message.guild.id,
                userId,
                action,
                error,
            });
            return { action, ok: false, outcome };
        }
    });
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
    DEFAULT_CLEANUP_DELAY_MS,
    DEFAULT_TIMEOUT_DURATION_MS,
    HONEYPOT_CLEANUP_LIMIT,
    MAX_TIMEOUT_DURATION_MS,
    buildAlertEmbed,
    buildHoneypotNoticeEmbed,
    buildLimitedAccountRecoveryPanelPayload,
    createHoneypotButtons,
    customIds,
    deleteRecentUserMessages,
    deleteRecentUserMessagesWithReport,
    fetchRecentUserMessagesFromGuild,
    filterRestorableRoleIds,
    getHoneypotConfig,
    getRemovableRoleIds,
    handleHoneypotButton,
    handleHoneypotMessage,
    limitHoneypotUser,
    moderatorCanUseHoneypotAction,
    postOrRefreshLimitedAccountRecoveryPanel,
    resumeHoneypotCleanupJobs,
    restoreLimitedAccount,
    sendHoneypotNotice,
    timeoutHoneypotUser,
    updateHoneypotAlert,
    validateLimitedAccountSetup,
};
