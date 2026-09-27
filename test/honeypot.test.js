const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { deleteRecentUserMessages } = require('../utils/honeypot');

function createMessage(id, authorId, createdTimestamp, result = 'resolve') {
    return {
        id,
        author: { id: authorId },
        createdTimestamp,
        deletable: true,
        delete: () => result === 'resolve' ? Promise.resolve() : Promise.reject(new Error('delete failed')),
    };
}

test('deleteRecentUserMessages counts only successful deletes across guild channels', async () => {
    const target = createMessage('target', 'user', 4);
    const failed = createMessage('failed', 'user', 3, 'reject');
    const otherChannel = createMessage('other', 'user', 2);
    const otherUser = createMessage('other-user', 'other', 1);

    const permissions = { has: permission => permission === PermissionFlagsBits.ViewChannel || permission === PermissionFlagsBits.ReadMessageHistory || permission === PermissionFlagsBits.ManageMessages };
    const channelA = {
        type: ChannelType.GuildText,
        viewable: true,
        permissionsFor: () => permissions,
        messages: { fetch: async () => new Map([[target.id, target], [failed.id, failed]]) },
    };
    const channelB = {
        type: ChannelType.GuildText,
        viewable: true,
        permissionsFor: () => permissions,
        messages: { fetch: async () => new Map([[otherChannel.id, otherChannel], [otherUser.id, otherUser]]) },
    };

    const deleted = await deleteRecentUserMessages({
        ...target,
        author: { id: 'user' },
        guild: {
            members: { me: {}, fetchMe: async () => ({}) },
            channels: { fetch: async () => new Map([['a', channelA], ['b', channelB]]) },
        },
    });

    assert.equal(deleted, 2);
});
