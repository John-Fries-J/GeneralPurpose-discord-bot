const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
    canManageDashboard,
    requireCsrf,
    createSessionToken,
    getOAuthStateCount,
    makeDiscordOauthUrl,
    parseCookies,
    resolveDashboardChannel,
    userCanAdminDashboard,
    verifySessionToken,
} = require('../web/dashboard');
const {
    canUseSetup,
    createDraft,
    validateSetupDraft,
} = require('../utils/setupWizard');

function csrfResult(body, session = { csrfToken: 'valid' }) {
    let statusCode = 200;
    let sent = null;
    let nextCalled = false;
    const req = {
        body,
        dashboardSession: session,
    };
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        send(value) {
            sent = value;
            return this;
        },
    };
    requireCsrf(req, res, () => {
        nextCalled = true;
    });
    return { statusCode, sent, nextCalled };
}

function fakeGuild(member) {
    return {
        id: 'guild-a',
        ownerId: 'owner',
        members: {
            fetch: async userId => (userId === member?.id ? member : null),
        },
    };
}

function loadDashboardWithConfig(config) {
    const dashboardPath = require.resolve('../web/dashboard');
    const configModule = require('../utils/config');
    const originalGetConfig = configModule.getConfig;
    const originalGetStoredConfig = configModule.getStoredConfig;
    delete require.cache[dashboardPath];
    configModule.getConfig = () => config;
    configModule.getStoredConfig = () => config;
    const dashboard = require('../web/dashboard');

    return {
        dashboard,
        restore() {
            configModule.getConfig = originalGetConfig;
            configModule.getStoredConfig = originalGetStoredConfig;
            delete require.cache[dashboardPath];
        },
    };
}

test('dashboard authorization rejects ManageGuild-only users and accepts owners/admins', async () => {
    const manageOnly = {
        id: 'manage-only',
        permissions: {
            has: permission => permission === PermissionFlagsBits.ManageGuild,
        },
        roles: { cache: new Map() },
    };
    const admin = {
        id: 'admin',
        permissions: {
            has: permission => permission === PermissionFlagsBits.Administrator,
        },
        roles: { cache: new Map() },
    };

    assert.equal(await userCanAdminDashboard(null, 'manage-only', fakeGuild(manageOnly)), false);
    assert.equal(await userCanAdminDashboard(null, 'owner', fakeGuild(null)), true);
    assert.equal(await userCanAdminDashboard(null, 'admin', fakeGuild(admin)), true);

    assert.equal(await canManageDashboard(
        { id: 'manage-only' },
        [{ id: 'guild-a', permissions: `${PermissionFlagsBits.ManageGuild}` }],
        { guildId: 'guild-a' },
        null,
    ), false);
    assert.equal(await canManageDashboard(
        { id: 'admin' },
        [{ id: 'guild-a', permissions: `${PermissionFlagsBits.Administrator}` }],
        { guildId: 'guild-a' },
        null,
    ), true);
});

test('dashboard authorization ignores undocumented dashboard user and role allowlists', async () => {
    const { dashboard, restore } = loadDashboardWithConfig({
        devs: [],
        dashboard: {
            adminUserIds: ['dashboard-user'],
            adminRoleIds: ['dashboard-role'],
        },
    });
    const roleOnly = {
        id: 'role-only',
        permissions: { has: () => false },
        roles: { cache: new Map([['dashboard-role', {}]]) },
    };

    try {
        assert.equal(await dashboard.userCanAdminDashboard(null, 'dashboard-user', fakeGuild(null)), false);
        assert.equal(await dashboard.userCanAdminDashboard(null, 'role-only', fakeGuild(roleOnly)), false);
    } finally {
        restore();
    }
});

test('session helpers reject malformed cookies and signatures without throwing', () => {
    assert.deepEqual(parseCookies('dashboard_session=%; theme=dark'), {
        dashboard_session: '',
        theme: 'dark',
    });

    const token = createSessionToken({
        user: { id: '123' },
        csrfToken: 'csrf',
        expiresAt: Date.now() + 60_000,
    });

    assert.equal(verifySessionToken(`${token}.extra`), null);
    assert.equal(verifySessionToken('not-a-token.x'), null);
});

test('OAuth state storage expires and is capped', () => {
    for (let index = 0; index < 550; index += 1) {
        makeDiscordOauthUrl({
            publicUrl: 'https://dashboard.example.com',
            oauth: {
                clientId: 'client',
                redirectUri: 'https://dashboard.example.com/auth/discord/callback',
            },
        });
    }

    assert.equal(getOAuthStateCount(), 500);
});

test('csrf middleware rejects missing or invalid tokens and accepts valid tokens', () => {
    assert.deepEqual(csrfResult({}), {
        statusCode: 403,
        sent: 'Invalid dashboard request.',
        nextCalled: false,
    });
    assert.deepEqual(csrfResult({ _csrf: 'wrong' }), {
        statusCode: 403,
        sent: 'Invalid dashboard request.',
        nextCalled: false,
    });
    assert.deepEqual(csrfResult({ _csrf: 'valid' }), {
        statusCode: 200,
        sent: null,
        nextCalled: true,
    });
});

test('dashboard channel resolver rejects cross-guild and stale sender targets', async () => {
    const crossGuildChannel = {
        id: 'channel-b',
        guildId: 'guild-b',
        type: ChannelType.GuildText,
        send: async () => null,
    };
    const goodChannel = {
        id: 'channel-a',
        guildId: 'guild-a',
        type: ChannelType.GuildText,
        send: async () => null,
    };
    const guild = {
        id: 'guild-a',
        members: { me: {} },
        channels: {
            cache: new Map([['channel-a', goodChannel], ['channel-b', crossGuildChannel]]),
            fetch: async id => (id === 'missing' ? null : undefined),
        },
    };

    assert.equal((await resolveDashboardChannel(guild, 'channel-a', {
        types: [ChannelType.GuildText],
        requireSendable: true,
    })).id, 'channel-a');
    await assert.rejects(
        () => resolveDashboardChannel(guild, 'channel-b', { types: [ChannelType.GuildText], requireSendable: true }),
        /not part of this server/,
    );
    await assert.rejects(
        () => resolveDashboardChannel(guild, 'missing', { types: [ChannelType.GuildText] }),
        /not part of this server/,
    );
});

test('setup permissions fail closed and save validation rejects stale objects', async () => {
    assert.equal(canUseSetup({}), false);
    assert.equal(canUseSetup({ memberPermissions: { has: () => false } }), false);
    assert.equal(canUseSetup({ memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } }), true);

    const draft = createDraft({}, 0);
    draft.welcome.enabled = true;
    draft.welcome.channelId = 'deleted-channel';
    await assert.rejects(
        () => validateSetupDraft({
            guild: {
                id: 'guild-a',
                channels: {
                    cache: new Map(),
                    fetch: async () => null,
                },
            },
        }, 'welcome', draft),
        /Welcome channel is no longer part of this server/,
    );
});
