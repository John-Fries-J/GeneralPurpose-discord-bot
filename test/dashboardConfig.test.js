const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { applyDashboardSettings, intField } = require('../web/services/dashboardConfig');

const channels = [
    { id: 'text-1', name: 'general', type: ChannelType.GuildText, guildId: 'guild-a' },
    { id: 'news-1', name: 'updates', type: ChannelType.GuildAnnouncement, guildId: 'guild-a' },
    { id: 'voice-1', name: 'Create Voice', type: ChannelType.GuildVoice, guildId: 'guild-a' },
    { id: 'category-1', name: 'Tickets', type: ChannelType.GuildCategory, guildId: 'guild-a' },
    { id: 'foreign-text', name: 'elsewhere', type: ChannelType.GuildText, guildId: 'guild-b' },
];
const roles = [
    { id: 'role-1', name: 'Moderator' },
];

test('dashboard welcome settings use channel selectors and embed fields', () => {
    const config = {};
    const result = applyDashboardSettings(config, {
        section: 'welcome',
        welcomeEnabled: 'on',
        welcomeID: 'text-1',
        welcomeTitle: 'Welcome',
        welcomeDescription: 'Hi {user}',
        welcomeFooter: 'Enjoy your stay',
    }, { channels });

    assert.equal(result.message, 'Welcome settings saved');
    assert.equal(config.welcomeID, 'text-1');
    assert.deepEqual(config.WelcomeEmbed, {
        title: 'Welcome',
        description: 'Hi {user}',
        footer: 'Enjoy your stay',
    });
});

test('dashboard welcome settings reject unknown or wrong channel types', () => {
    assert.throws(() => applyDashboardSettings({}, {
        section: 'welcome',
        welcomeEnabled: 'on',
        welcomeID: 'missing',
    }, { channels }), /Welcome channel must be a channel from this server/);

    assert.throws(() => applyDashboardSettings({}, {
        section: 'welcome',
        welcomeEnabled: 'on',
        welcomeID: 'voice-1',
    }, { channels }), /Welcome channel has the wrong channel type/);
});

test('dashboard ticket settings map role and channel selectors', () => {
    const config = {};
    applyDashboardSettings(config, {
        section: 'tickets',
        ticketChannelId: 'text-1',
        ticketCategoryId: 'category-1',
        supportRoleId: 'role-1',
        allowTranscripts: 'on',
        allowClaiming: 'on',
        closeInactivityDays: '14',
    }, { channels, roles });

    assert.deepEqual(config.tickets, {
        channelId: 'text-1',
        categoryId: 'category-1',
        supportRoleId: 'role-1',
        allowTranscripts: true,
        allowUserAdding: false,
        allowClaiming: true,
        closeInactivityDays: 14,
    });
});

test('dashboard ticket settings reject incomplete channel/category/role combinations', () => {
    assert.throws(() => applyDashboardSettings({}, {
        section: 'tickets',
        ticketChannelId: 'text-1',
    }, { channels, roles, guildId: 'guild-a' }), /Ticket category is required/);

    assert.throws(() => applyDashboardSettings({}, {
        section: 'tickets',
        ticketCategoryId: 'category-1',
        supportRoleId: 'role-1',
    }, { channels, roles, guildId: 'guild-a' }), /Ticket panel channel is required/);
});

test('dashboard join-to-create settings validate bounded numbers', () => {
    assert.throws(() => applyDashboardSettings({}, {
        section: 'joinToCreate',
        enabled: 'on',
        triggerChannelId: 'voice-1',
        userLimitMax: '120',
    }, { channels }), /Maximum users must be between 1 and 99/);

    assert.equal(intField({ count: '' }, 'count', { fallback: 7 }), 7);
    assert.throws(() => intField({ count: 'abc' }, 'count', { label: 'Count' }), /Count must be a whole number/);
    assert.throws(() => applyDashboardSettings({}, {
        section: 'joinToCreate',
        enabled: 'on',
        triggerChannelId: 'text-1',
    }, { channels, guildId: 'guild-a' }), /Trigger channel has the wrong channel type/);
    assert.throws(() => applyDashboardSettings({}, {
        section: 'joinToCreate',
        enabled: 'on',
        triggerChannelId: 'voice-1',
        categoryId: 'text-1',
    }, { channels, guildId: 'guild-a' }), /Temporary channel category has the wrong channel type/);
});

test('dashboard leveling settings require known modes', () => {
    const config = {};
    applyDashboardSettings(config, {
        section: 'leveling',
        enabled: 'on',
        mode: 'both',
        textXpPerMessage: '3',
        voiceXpPerMinute: '2',
        cooldownSeconds: '45',
    });

    assert.deepEqual(config.leveling, {
        enabled: true,
        mode: 'both',
        textXpPerMessage: 3,
        voiceXpPerMinute: 2,
        cooldownSeconds: 45,
    });

    assert.throws(() => applyDashboardSettings({}, {
        section: 'leveling',
        mode: 'everything',
    }), /Leveling mode must be text, voice, or both/);
});

test('dashboard module settings only accept known module keys', () => {
    const config = {};
    applyDashboardSettings(config, {
        section: 'modules',
        moduleKeys: 'moderation,music',
        'module:moderation': 'on',
    }, { allowedModules: ['moderation', 'music'] });

    assert.deepEqual(config.commandSettings.modules, {
        moderation: true,
        music: false,
    });

    assert.throws(() => applyDashboardSettings({}, {
        section: 'modules',
        moduleKeys: 'moderation,admin',
    }, { allowedModules: ['moderation'] }), /Unknown module setting submitted/);
});

test('dashboard logging settings reject wrong-guild and stale channels', () => {
    assert.throws(() => applyDashboardSettings({}, {
        section: 'logging',
        logChannel: 'foreign-text',
    }, { channels, guildId: 'guild-a' }), /logChannel log channel must be a channel from this server/);

    assert.throws(() => applyDashboardSettings({}, {
        section: 'logging',
        moderation: 'deleted-text',
    }, { channels, guildId: 'guild-a' }), /moderation log channel must be a channel from this server/);
});

test('dashboard moderation settings use role selector and URL validation', () => {
    const config = {};
    applyDashboardSettings(config, {
        section: 'moderation',
        muteRoleId: 'role-1',
        muteRoleName: 'Muted',
        appealUrl: 'https://appeals.example.com',
    }, { roles });

    assert.deepEqual(config.moderation, {
        muteRoleId: 'role-1',
        muteRoleName: 'Muted',
        appealUrl: 'https://appeals.example.com',
    });

    assert.throws(() => applyDashboardSettings({}, {
        section: 'moderation',
        muteRoleId: 'deleted-role',
    }, { roles }), /Mute role must be a role from this server/);

    assert.throws(() => applyDashboardSettings({}, {
        section: 'moderation',
        appealUrl: 'javascript:alert(1)',
    }, { roles }), /Appeal URL must use http or https/);
});

test('dashboard music settings use bounded structured controls', () => {
    const config = {};
    applyDashboardSettings(config, {
        section: 'music',
        enabled: 'on',
        maxQueueLength: '75',
        allowFileUploads: 'on',
        voiceReadyTimeoutMs: '45000',
        voiceJoinRetries: '2',
        voiceRetryDelayMs: '1500',
        voiceDebug: 'on',
        ytDlpCookiesPath: 'data/cookies.txt',
    });

    assert.deepEqual(config.music, {
        enabled: true,
        maxQueueLength: 75,
        allowFileUploads: true,
        voiceReadyTimeoutMs: 45000,
        voiceJoinRetries: 2,
        voiceRetryDelayMs: 1500,
        voiceDebug: true,
        ytDlpCookiesPath: 'data/cookies.txt',
    });

    assert.throws(() => applyDashboardSettings({}, {
        section: 'music',
        maxQueueLength: '0',
    }), /Maximum queue length must be between 1 and 1000/);
});
