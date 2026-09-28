const language = require('./language');
const { createEmbed } = require('./embeds');
const { fetchMember, safeDm } = require('./discord');
const { sendLog, formatUser } = require('./logging');
const { getConfig, updateConfig } = require('./config');
const { PermissionFlagsBits } = require('discord.js');
const { addUserHistory, createModerationCase } = require('./store');

function isSelfAction(interaction, user) {
    return user.id === interaction.user.id;
}

function isOwnerAction(interaction, user) {
    return user.id === interaction.guild.ownerId;
}

function isHigherOrEqualRole(interaction, member) {
    if (!member || interaction.guild.ownerId === interaction.user.id) return false;
    return member.roles.highest.position >= interaction.member.roles.highest.position;
}

async function validateTarget(interaction, user, capability) {
    const member = await fetchMember(interaction.guild, user.id);

    if (isSelfAction(interaction, user)) {
        return { ok: false, member, message: language.moderation.cannotModerateSelf };
    }

    if (isOwnerAction(interaction, user)) {
        return { ok: false, member, message: language.moderation.cannotModerateOwner };
    }

    if (isHigherOrEqualRole(interaction, member)) {
        return { ok: false, member, message: language.moderation.cannotModerateHigherRole };
    }

    if (!member) {
        return { ok: false, member, message: language.moderation.userNotInServer };
    }

    if (capability && !member[capability]) {
        return { ok: false, member, message: language.moderation.cannotModerateUser };
    }

    return { ok: true, member };
}

async function sendModerationDm(user, options) {
    const appealUrl = getConfig().moderation?.appealUrl;
    const description = appealUrl
        ? `${options.description}\n\nAppeal: ${appealUrl}`
        : options.description;
    const embed = createEmbed({
        title: options.title,
        description,
        color: options.color,
    });

    return safeDm(user, { embeds: [embed] });
}

async function logModerationAction(interaction, options) {
    const caseRecord = options.caseType && options.user
        ? await createModerationCase({
            guildId: interaction.guild.id,
            type: options.caseType,
            userId: options.user.id,
            userTag: options.user.tag,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag,
            reason: options.reason || language.general.noReason,
            duration: options.duration,
        })
        : null;

    if (options.user && options.caseType) {
        await addUserHistory({
            guildId: interaction.guild.id,
            userId: options.user.id,
            userTag: options.user.tag,
            type: `moderation:${options.caseType}`,
            summary: `${options.title}${caseRecord ? ` (#${caseRecord.id})` : ''}: ${options.reason || language.general.noReason}`,
            channelId: interaction.channelId,
            moderatorId: interaction.user.id,
            metadata: {
                caseId: caseRecord?.id,
                duration: options.duration || null,
            },
        });
    }

    return sendLog(interaction.guild, {
        type: 'moderation',
        title: options.title,
        color: options.color,
        user: options.user || interaction.user,
        fields: [
            ...(caseRecord ? [{ name: 'Case', value: `#${caseRecord.id}`, inline: true }] : []),
            { name: 'User', value: options.user ? formatUser(options.user) : 'Unknown', inline: true },
            { name: 'Moderator', value: formatUser(interaction.user), inline: true },
            { name: 'Reason', value: options.reason || language.general.noReason },
            ...(options.extraFields || []),
        ],
    }).catch(error => {
        console.error('Failed to send moderation log:', error);
        return false;
    });
}

async function applyMuteOverwrites(guild, muteRole) {
    const channels = await guild.channels.fetch();
    await Promise.allSettled(channels.map(channel => {
        if (!channel?.permissionOverwrites?.edit) return null;
        return channel.permissionOverwrites.edit(muteRole, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false, Speak: false })
            .catch(error => {
                console.error(`Failed to update mute overwrites for ${channel.id}:`, error);
                return null;
            });
    }));
}

async function getOrCreateMuteRole(guild) {
    const config = getConfig();
    const configuredRole = config.moderation?.muteRoleId ? guild.roles.cache.get(config.moderation.muteRoleId) : null;
    if (configuredRole) return configuredRole;

    const roleName = config.moderation?.muteRoleName || 'Muted';
    const role = await guild.roles.create({
        name: roleName,
        colors: { primaryColor: 0x747f8d },
        permissions: [],
        reason: 'Creating role-based mute role',
    });

    updateConfig(current => {
        current.moderation = current.moderation || {};
        current.moderation.muteRoleId = role.id;
        current.moderation.muteRoleName = roleName;
        return current;
    });

    await applyMuteOverwrites(guild, role);
    return role;
}

function getRemovableRoles(member, muteRole) {
    const botMember = member.guild.members.me;
    return member.roles.cache
        .filter(role => role.id !== member.guild.id)
        .filter(role => role.id !== muteRole.id)
        .filter(role => !role.managed)
        .filter(role => botMember.roles.highest.comparePositionTo(role) > 0);
}

async function muteMemberWithRole(member, muteRole) {
    const removableRoles = [...getRemovableRoles(member, muteRole).values()];
    const removedRoleIds = removableRoles.map(role => role.id);

    if (!member.roles.cache.has(muteRole.id)) {
        await member.roles.add(muteRole, 'Applying role-based mute');
    }

    if (removedRoleIds.length) {
        await member.roles.remove(removedRoleIds, 'Role-based mute removes normal roles while active');
    }

    return removedRoleIds;
}

async function restoreMutedMember(member, muteRole, roleIds, reason = 'Role-based mute expired') {
    const botMember = member.guild.members.me;
    const restorableRoleIds = roleIds
        .map(roleId => member.guild.roles.cache.get(roleId))
        .filter(role => role && !role.managed && botMember.roles.highest.comparePositionTo(role) > 0)
        .map(role => role.id);

    if (restorableRoleIds.length) {
        await member.roles.add(restorableRoleIds, reason);
    }

    if (member.roles.cache.has(muteRole.id)) {
        await member.roles.remove(muteRole, reason);
    }

    return restorableRoleIds;
}

module.exports = {
    applyMuteOverwrites,
    getOrCreateMuteRole,
    logModerationAction,
    muteMemberWithRole,
    restoreMutedMember,
    sendModerationDm,
    validateTarget,
};
