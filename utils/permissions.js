const { PermissionsBitField } = require('discord.js');

function getDefaultPermissionBits(command) {
    const serialized = command?.data?.toJSON?.();
    return serialized?.default_member_permissions ?? null;
}

function memberCanUseCommand(interaction, command) {
    const defaultPermissions = getDefaultPermissionBits(command);
    if (!defaultPermissions) return true;
    if (!interaction.inGuild?.() || !interaction.memberPermissions) return false;

    return interaction.memberPermissions.has(new PermissionsBitField(BigInt(defaultPermissions)));
}

module.exports = {
    getDefaultPermissionBits,
    memberCanUseCommand,
};
