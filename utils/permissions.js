const { PermissionsBitField } = require('discord.js');
const { getConfig } = require('./config');

function getDefaultPermissionBits(command) {
    const serialized = command?.data?.toJSON?.();
    return serialized?.default_member_permissions ?? null;
}

function normalizeIdList(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') {
        return value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
    }

    return [];
}

function getCommandAccess(commandName, config = getConfig()) {
    const access = config.commandSettings?.access?.[commandName] || {};
    return {
        allowRoleIds: normalizeIdList(access.allowRoleIds),
        allowUserIds: normalizeIdList(access.allowUserIds),
        denyRoleIds: normalizeIdList(access.denyRoleIds),
        denyUserIds: normalizeIdList(access.denyUserIds),
    };
}

function memberHasAnyRole(interaction, roleIds) {
    if (!roleIds.length) return false;
    return roleIds.some(roleId => interaction.member?.roles?.cache?.has(roleId));
}

function memberMatchesCommandAccess(interaction, commandName, config = getConfig()) {
    const access = getCommandAccess(commandName, config);
    const userId = interaction.user?.id;

    if (userId && access.denyUserIds.includes(userId)) return false;
    if (memberHasAnyRole(interaction, access.denyRoleIds)) return false;

    const hasAllowList = access.allowUserIds.length > 0 || access.allowRoleIds.length > 0;
    if (!hasAllowList) return true;

    return Boolean(
        userId && access.allowUserIds.includes(userId)
        || memberHasAnyRole(interaction, access.allowRoleIds),
    );
}

function memberCanUseCommand(interaction, command, config = getConfig()) {
    const name = typeof command === 'string' ? command : command?.data?.name;
    if (name && !memberMatchesCommandAccess(interaction, name, config)) return false;

    const defaultPermissions = getDefaultPermissionBits(command);
    if (!defaultPermissions) return true;
    if (!interaction.inGuild?.() || !interaction.memberPermissions) return false;

    return interaction.memberPermissions.has(new PermissionsBitField(BigInt(defaultPermissions)));
}

module.exports = {
    getCommandAccess,
    getDefaultPermissionBits,
    memberCanUseCommand,
    memberMatchesCommandAccess,
    normalizeIdList,
};
