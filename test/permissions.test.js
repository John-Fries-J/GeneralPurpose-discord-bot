const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getDefaultPermissionBits, memberCanUseCommand, memberMatchesCommandAccess, normalizeIdList } = require('../utils/permissions');

test('getDefaultPermissionBits reads slash command default permissions', () => {
    const command = {
        data: new SlashCommandBuilder()
            .setName('purge')
            .setDescription('Delete messages.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    };

    assert.equal(getDefaultPermissionBits(command), PermissionFlagsBits.ManageMessages.toString());
});

test('memberCanUseCommand allows commands without default permissions', () => {
    assert.equal(memberCanUseCommand({}, { data: { toJSON: () => ({}) } }), true);
});

test('memberCanUseCommand checks member permissions for protected commands', () => {
    const command = {
        data: new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban a user.')
            .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    };

    const allowedInteraction = {
        inGuild: () => true,
        memberPermissions: {
            has: permissions => permissions.has(PermissionFlagsBits.BanMembers),
        },
    };
    const deniedInteraction = {
        inGuild: () => true,
        memberPermissions: {
            has: () => false,
        },
    };

    assert.equal(memberCanUseCommand(allowedInteraction, command), true);
    assert.equal(memberCanUseCommand(deniedInteraction, command), false);
});

test('normalizeIdList accepts arrays and separated strings', () => {
    assert.deepEqual(normalizeIdList(['1', '', '2']), ['1', '2']);
    assert.deepEqual(normalizeIdList('1, 2\n3'), ['1', '2', '3']);
});

test('memberMatchesCommandAccess applies user and role allow deny lists', () => {
    const interaction = {
        user: { id: 'user-1' },
        member: {
            roles: {
                cache: new Map([['role-1', {}]]),
            },
        },
    };

    assert.equal(memberMatchesCommandAccess(interaction, 'ping', {
        commandSettings: {
            access: {
                ping: {
                    allowUserIds: ['user-1'],
                },
            },
        },
    }), true);

    assert.equal(memberMatchesCommandAccess(interaction, 'ping', {
        commandSettings: {
            access: {
                ping: {
                    allowRoleIds: ['role-2'],
                },
            },
        },
    }), false);

    assert.equal(memberMatchesCommandAccess(interaction, 'ping', {
        commandSettings: {
            access: {
                ping: {
                    allowRoleIds: ['role-1'],
                    denyUserIds: ['user-1'],
                },
            },
        },
    }), false);
});
