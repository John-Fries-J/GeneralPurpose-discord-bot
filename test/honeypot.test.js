const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle, ChannelType, ComponentType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { closeDatabase } = require('../database');
const {
    buildAlertEmbed,
    buildHoneypotNoticeEmbed,
    buildLimitedAccountRecoveryPanelPayload,
    createHoneypotButtons,
    customIds,
    deleteRecentUserMessages,
    deleteRecentUserMessagesWithReport,
    getHoneypotConfig,
    getRemovableRoleIds,
    handleHoneypotButton,
    limitHoneypotUser,
    moderatorCanUseHoneypotAction,
    restoreLimitedAccount,
    sendHoneypotNotice,
    timeoutHoneypotUser,
    updateHoneypotAlert,
    validateLimitedAccountSetup,
} = require('../utils/honeypot');
const {
    getLimitedAccount,
    listUserHistory,
    upsertLimitedAccount,
} = require('../utils/store');

function withEnvironment(environment) {
    const previous = {};
    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    return () => {
        closeDatabase();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    };
}

function permissions(...bits) {
    const allowed = new Set(bits);
    return { has: bit => allowed.has(bit) };
}

function role(id, position, options = {}) {
    return {
        id,
        name: id,
        position,
        managed: false,
        ...options,
    };
}

function addFindToMap(map) {
    map.find = predicate => {
        for (const value of map.values()) {
            if (predicate(value)) return value;
        }
        return undefined;
    };
    return map;
}

function normalizeIds(ids) {
    return (Array.isArray(ids) ? ids : [ids])
        .map(item => item?.id || item)
        .filter(Boolean);
}

function createMember(guild, user, roles, options = {}) {
    const cache = new Map(roles.map(item => [item.id, item]));
    const operations = { added: [], removed: [] };
    const member = {
        id: user.id,
        user,
        guild,
        bannable: options.bannable !== false,
        moderatable: options.moderatable !== false,
        roles: {
            cache,
            highest: roles.reduce((highest, current) => current.position > highest.position ? current : highest, roles[0]),
            add: async (ids, reason) => {
                if (options.failAdd) throw new Error('add failed');
                const roleIds = normalizeIds(ids);
                operations.added.push({ ids: roleIds, reason });
                for (const roleId of roleIds) {
                    const nextRole = guild.roles.cache.get(roleId) || role(roleId, 1);
                    cache.set(roleId, nextRole);
                }
            },
            remove: async (ids, reason) => {
                if (options.failRemove) throw new Error('remove failed');
                const roleIds = normalizeIds(ids);
                operations.removed.push({ ids: roleIds, reason });
                for (const roleId of roleIds) cache.delete(roleId);
            },
        },
        timeout: options.timeout,
    };
    member.operations = operations;
    return member;
}

function createGuildScenario(options = {}) {
    const everyone = role('guild', 0);
    const normal = role('normal', 2);
    const extra = role('extra', 3);
    const managed = role('managed', 4, { managed: true });
    const limited = role('limited', 5);
    const high = role('high', 20);
    const botRole = role('bot-role', options.botPosition || 15);
    const modRole = role('mod-role', options.modPosition || 14);
    const targetRoles = options.targetRoles || [everyone, normal, managed];
    const roles = addFindToMap(new Map([everyone, normal, extra, managed, limited, high, botRole, modRole].map(item => [item.id, item])));
    const recoveryChannel = {
        id: 'recovery',
        send: async payload => ({ id: 'panel-message', payload }),
        permissionsFor: () => permissions(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages),
    };
    const channels = addFindToMap(new Map([['recovery', recoveryChannel]]));
    const guild = {
        id: 'guild',
        name: 'Guild',
        ownerId: 'owner',
        roles: {
            cache: roles,
            fetch: async id => roles.get(id) || null,
        },
        channels: {
            cache: channels,
            fetch: async id => channels.get(id) || null,
        },
        members: {},
        client: {
            users: {
                fetch: async id => ({ id, tag: id === 'target' ? 'Target#0001' : `${id}#0001`, send: async () => null }),
            },
        },
    };
    const botMember = createMember(guild, { id: 'bot', tag: 'Bot#0001' }, [everyone, botRole], {
        ...options.botMemberOptions,
    });
    botMember.permissions = permissions(
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.CreateInstantInvite,
    );
    const targetMember = createMember(guild, { id: 'target', tag: 'Target#0001' }, targetRoles, options.targetMemberOptions);
    const moderatorMember = {
        id: 'moderator',
        roles: { highest: modRole },
        permissions: permissions(PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.BanMembers),
    };
    guild.members.me = botMember;
    guild.members.fetchMe = async () => botMember;
    guild.members.fetch = async id => {
        if (id === targetMember.id) return targetMember;
        if (id === botMember.id) return botMember;
        return null;
    };
    guild.members.ban = async (userId, payload) => {
        guild.lastBan = { userId, payload };
    };
    guild.members.unban = async (userId, reason) => {
        guild.lastUnban = { userId, reason };
    };

    return {
        botMember,
        guild,
        limited,
        managed,
        moderatorMember,
        normal,
        extra,
        high,
        targetMember,
    };
}

function createInteraction(scenario, options = {}) {
    const memberPermissions = options.memberPermissions || permissions(PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.BanMembers);
    return {
        guild: scenario.guild,
        guildId: scenario.guild.id,
        channelId: 'alerts',
        user: { id: 'moderator', tag: 'Mod#0001' },
        member: { ...scenario.moderatorMember, permissions: memberPermissions },
        memberPermissions,
        client: scenario.guild.client,
    };
}

function tempSqliteEnvironment(prefix = 'bot-honeypot-') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    return {
        directory,
        restore() {
            restore();
            fs.rmSync(directory, { recursive: true, force: true });
        },
    };
}

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

test('honeypot cleanup second pass catches new user messages without duplicate deletes', async () => {
    const deletedIds = [];
    const messages = new Map();
    const permissions = { has: permission => permission === PermissionFlagsBits.ViewChannel || permission === PermissionFlagsBits.ReadMessageHistory || permission === PermissionFlagsBits.ManageMessages };
    const channel = {
        id: 'general',
        type: ChannelType.GuildText,
        viewable: true,
        permissionsFor: () => permissions,
        messages: { fetch: async () => new Map(messages) },
    };
    const makeTrackedMessage = (id, authorId, createdTimestamp) => ({
        ...createMessage(id, authorId, createdTimestamp),
        channel,
        delete: async () => {
            deletedIds.push(id);
            messages.delete(id);
        },
    });
    const first = makeTrackedMessage('first', 'user', 100);
    messages.set(first.id, first);
    const seenIds = new Set();
    const context = {
        guild: {
            members: { me: {}, fetchMe: async () => ({}) },
            channels: { fetch: async () => new Map([[channel.id, channel]]) },
        },
        userId: 'user',
        extraMessages: new Map([[first.id, first]]),
    };

    const immediate = await deleteRecentUserMessagesWithReport(context, 15, { seenIds });
    const duringCleanup = makeTrackedMessage('during-cleanup', 'user', 200);
    const otherUser = makeTrackedMessage('other-user', 'other', 300);
    messages.set(duringCleanup.id, duringCleanup);
    messages.set(otherUser.id, otherUser);
    const delayed = await deleteRecentUserMessagesWithReport(context, 15, { seenIds });

    assert.equal(immediate.deletedCount, 1);
    assert.equal(delayed.deletedCount, 1);
    assert.deepEqual(deletedIds, ['first', 'during-cleanup']);
    assert.equal(messages.has('other-user'), true);
});

test('sendHoneypotNotice sends the configured warning embed safely', async () => {
    const sent = [];
    const channel = {
        send: async payload => {
            sent.push(payload);
        },
    };

    assert.equal(buildHoneypotNoticeEmbed().data.description, 'This is to catch scam bots/accounts, typing in here may get you perm banned!');
    assert.equal(await sendHoneypotNotice(channel), true);
    assert.equal(sent[0].embeds[0].data.description, 'This is to catch scam bots/accounts, typing in here may get you perm banned!');
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test('getHoneypotConfig keeps legacy honeypot settings backwards compatible', () => {
    const settings = getHoneypotConfig({
        honeypot: {
            enabled: true,
            channelId: 'honeypot',
            alertChannelId: 'alerts',
        },
    });

    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.actions, { limit: true, softban: true, timeout: true, ignore: true });
    assert.equal(settings.timeoutDurationMs, 3600000);
    assert.equal(settings.limitedAccount.enabled, true);
    assert.equal(settings.limitedAccount.removeExistingRoles, true);
});

test('createHoneypotButtons builds the requested actions without the legacy ban button', () => {
    const row = createHoneypotButtons('target')[0].toJSON();
    const labels = row.components.map(component => component.label);
    const customIdList = row.components.map(component => component.custom_id);

    assert.deepEqual(labels, ['Limit User', 'Soft Ban', 'Time Out', 'Ignore']);
    assert(!customIdList.includes(customIds.ban('target')));
    assert.equal(row.components[0].style, ButtonStyle.Danger);

    const disabled = createHoneypotButtons('target', true)[0].toJSON();
    assert(disabled.components.every(component => component.disabled === true));
});

test('honeypot action permission checks are action specific', () => {
    const scenario = createGuildScenario();
    const manageRoles = createInteraction(scenario, { memberPermissions: permissions(PermissionFlagsBits.ManageRoles) });
    const moderate = createInteraction(scenario, { memberPermissions: permissions(PermissionFlagsBits.ModerateMembers) });
    const ban = createInteraction(scenario, { memberPermissions: permissions(PermissionFlagsBits.BanMembers) });
    const reviewer = createInteraction(scenario, { memberPermissions: permissions(PermissionFlagsBits.ManageMessages) });

    assert.equal(moderatorCanUseHoneypotAction(manageRoles, 'limit'), true);
    assert.equal(moderatorCanUseHoneypotAction(manageRoles, 'softban'), false);
    assert.equal(moderatorCanUseHoneypotAction(moderate, 'timeout'), true);
    assert.equal(moderatorCanUseHoneypotAction(moderate, 'softban'), false);
    assert.equal(moderatorCanUseHoneypotAction(ban, 'softban'), true);
    assert.equal(moderatorCanUseHoneypotAction(reviewer, 'ignore'), true);
});

test('getRemovableRoleIds excludes managed, @everyone, limited, and bot-higher roles', () => {
    const scenario = createGuildScenario({
        targetRoles: [
            role('guild', 0),
            role('normal', 2),
            role('managed', 3, { managed: true }),
            role('limited', 4),
            role('high', 20),
        ],
    });

    const removable = getRemovableRoleIds(scenario.targetMember, scenario.botMember, 'limited');

    assert.deepEqual(removable, ['normal']);
});

test('validateLimitedAccountSetup reports actionable limited-role diagnostics', async () => {
    const scenario = createGuildScenario();
    const diagnostics = await validateLimitedAccountSetup(scenario.guild, getHoneypotConfig({
        honeypot: {
            limitedAccount: {
                roleId: '',
                channelId: '',
            },
        },
    }));

    assert(diagnostics.diagnostics.includes('Set a limited account role.'));
    assert(diagnostics.diagnostics.includes('Set a limited account recovery channel.'));
});

test('limitHoneypotUser rejects moderator hierarchy violations', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario({
        modPosition: 4,
        targetRoles: [role('guild', 0), role('normal', 8)],
    });

    try {
        await assert.rejects(
            () => limitHoneypotUser(createInteraction(scenario), 'target', getHoneypotConfig({
                honeypot: {
                    limitedAccount: { roleId: 'limited', channelId: 'recovery', panelMessageId: 'panel' },
                },
            })),
            /equal or higher role/,
        );
        assert.equal(await getLimitedAccount('guild', 'target'), null);
    } finally {
        env.restore();
    }
});

test('limitHoneypotUser persists snapshot before removing roles and records history', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario();

    try {
        const result = await limitHoneypotUser(createInteraction(scenario), 'target', getHoneypotConfig({
            honeypot: {
                limitedAccount: { roleId: 'limited', channelId: 'recovery', panelMessageId: 'panel' },
            },
        }));
        const record = await getLimitedAccount('guild', 'target');
        const history = await listUserHistory('guild', 'target', 10);

        assert.match(result.outcome, /Removed 1 role/);
        assert.equal(record.status, 'active');
        assert.deepEqual(record.previousRoleIds, ['normal']);
        assert.deepEqual(scenario.targetMember.operations.added[0].ids, ['limited']);
        assert.deepEqual(scenario.targetMember.operations.removed[0].ids, ['normal']);
        assert.equal(history[0].type, 'honeypot:limit');
    } finally {
        env.restore();
    }
});

test('limitHoneypotUser leaves a recoverable persisted record when role mutation fails', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario({
        targetMemberOptions: { failRemove: true },
    });

    try {
        await assert.rejects(
            () => limitHoneypotUser(createInteraction(scenario), 'target', getHoneypotConfig({
                honeypot: {
                    limitedAccount: { roleId: 'limited', channelId: 'recovery', panelMessageId: 'panel' },
                },
            })),
            /remove failed/,
        );
        const record = await getLimitedAccount('guild', 'target');

        assert.equal(record.status, 'active');
        assert.deepEqual(record.previousRoleIds, ['normal']);
        assert.deepEqual(scenario.targetMember.operations.added[0].ids, ['limited']);
    } finally {
        env.restore();
    }
});

test('second attempt to limit the same user is safe', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario();
    const settings = getHoneypotConfig({
        honeypot: {
            limitedAccount: { roleId: 'limited', channelId: 'recovery', panelMessageId: 'panel' },
        },
    });

    try {
        await limitHoneypotUser(createInteraction(scenario), 'target', settings);
        await assert.rejects(
            () => limitHoneypotUser(createInteraction(scenario), 'target', settings),
            /already limited/,
        );
        assert.equal(scenario.targetMember.operations.added.length, 1);
    } finally {
        env.restore();
    }
});

test('restoreLimitedAccount restores valid roles, removes limited role, and is idempotent', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario({
        targetRoles: [role('guild', 0), role('limited', 5)],
    });

    try {
        await upsertLimitedAccount({
            guildId: 'guild',
            userId: 'target',
            previousRoleIds: ['normal', 'missing', 'managed'],
            limitedRoleId: 'limited',
            limitedChannelId: 'recovery',
            limitedBy: 'moderator',
            limitedAt: 100,
            status: 'active',
        });

        const interaction = {
            guild: scenario.guild,
            channelId: 'recovery',
            user: { id: 'target', tag: 'Target#0001' },
        };
        const restored = await restoreLimitedAccount(interaction, 'self_service');
        const repeated = await restoreLimitedAccount(interaction, 'self_service');
        const record = await getLimitedAccount('guild', 'target');
        const history = await listUserHistory('guild', 'target', 10);

        assert.equal(restored.ok, true);
        assert.deepEqual(restored.restoredRoleIds, ['normal']);
        assert.equal(repeated.alreadyRestored, true);
        assert.equal(record.status, 'restored');
        assert.equal(record.restorationSource, 'self_service');
        assert.deepEqual(scenario.targetMember.operations.added[0].ids, ['normal']);
        assert.deepEqual(scenario.targetMember.operations.removed[0].ids, ['limited']);
        assert.equal(history[0].type, 'honeypot:restore');
        assert.equal(scenario.targetMember.operations.added.length, 1);
    } finally {
        env.restore();
    }
});

test('timeoutHoneypotUser applies configured timeout and records history', async () => {
    const env = tempSqliteEnvironment();
    let timeoutPayload = null;
    const scenario = createGuildScenario({
        targetMemberOptions: {
            timeout: async (durationMs, reason) => {
                timeoutPayload = { durationMs, reason };
            },
        },
    });

    try {
        await timeoutHoneypotUser(createInteraction(scenario, {
            memberPermissions: permissions(PermissionFlagsBits.ModerateMembers),
        }), 'target', getHoneypotConfig({
            honeypot: {
                timeoutDurationMs: 120000,
            },
        }));
        const history = await listUserHistory('guild', 'target', 10);

        assert.deepEqual(timeoutPayload, { durationMs: 120000, reason: 'Scam' });
        assert.equal(history[0].type, 'honeypot:timeout');
        assert.equal(history[0].metadata.durationMs, 120000);
    } finally {
        env.restore();
    }
});

test('handleHoneypotButton softban path uses invite, ban, and unban service flow', async () => {
    const env = tempSqliteEnvironment();
    const scenario = createGuildScenario();
    const inviteChannel = {
        id: 'general',
        permissionsFor: () => permissions(PermissionFlagsBits.CreateInstantInvite),
        createInvite: async payload => {
            scenario.guild.lastInvite = payload;
            return { url: 'https://discord.gg/test' };
        },
    };
    scenario.guild.channels.cache.set('general', inviteChannel);
    const edits = [];
    const interaction = {
        ...createInteraction(scenario, { memberPermissions: permissions(PermissionFlagsBits.BanMembers) }),
        customId: customIds.softban('target'),
        isButton: () => true,
        deferUpdate: async () => null,
        message: {
            id: 'alert-softban',
            embeds: [buildAlertEmbed({ author: { id: 'target', tag: 'Target#0001' }, channelId: 'trap', content: 'hello' }, 2)],
            edit: async payload => edits.push(payload),
        },
    };

    try {
        assert.equal(await handleHoneypotButton(interaction), true);
        const history = await listUserHistory('guild', 'target', 10);

        assert.equal(scenario.guild.lastInvite.reason, 'Softban invite for Target#0001: Scam');
        assert.equal(scenario.guild.lastBan.payload.reason, 'Scam');
        assert.equal(scenario.guild.lastUnban.reason, 'Softban complete');
        assert.equal(history[0].type, 'honeypot:softban');
        assert.equal(edits[0].components[0].toJSON().components.every(component => component.disabled), true);
    } finally {
        env.restore();
    }
});

test('updateHoneypotAlert records success and failure states with retryable buttons', async () => {
    const scenario = createGuildScenario();
    const edits = [];
    const interaction = {
        ...createInteraction(scenario),
        message: {
            embeds: [buildAlertEmbed({ author: { id: 'target', tag: 'Target#0001' }, channelId: 'trap', content: 'hello' }, 1)],
            edit: async payload => {
                edits.push(payload);
                return payload;
            },
        },
    };

    await updateHoneypotAlert(interaction, 'target', 'limit', 'Limited by Mod#0001.', { disabled: true });
    await updateHoneypotAlert(interaction, 'target', 'timeout', 'Time Out failed.', { failed: true });

    const successFields = edits[0].embeds[0].data.fields;
    const failedFields = edits[1].embeds[0].data.fields;
    assert.equal(successFields.find(field => field.name === 'Review Status').value, 'Action completed');
    assert.equal(failedFields.find(field => field.name === 'Review Status').value, 'Time Out failed');
    assert(edits[0].components[0].toJSON().components.every(component => component.disabled));
    assert(edits[1].components[0].toJSON().components.every(component => !component.disabled));
});

test('limited account recovery panel uses a stable regain access button id', () => {
    const payload = buildLimitedAccountRecoveryPanelPayload();
    const json = payload.components[0].toJSON();
    const buttonRow = json.components.find(component => component.type === ComponentType.ActionRow);

    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(buttonRow.components[0].custom_id, customIds.regainAccess());
    assert.equal(buttonRow.components[0].label, 'Regain Access');
});
