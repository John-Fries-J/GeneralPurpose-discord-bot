const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { applyDashboardSettings, intField } = require('../web/services/dashboardConfig');

const channels = [
    { id: 'text-1', name: 'general', type: ChannelType.GuildText },
    { id: 'news-1', name: 'updates', type: ChannelType.GuildAnnouncement },
    { id: 'voice-1', name: 'Create Voice', type: ChannelType.GuildVoice },
    { id: 'category-1', name: 'Tickets', type: ChannelType.GuildCategory },
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

test('dashboard join-to-create settings validate bounded numbers', () => {
    assert.throws(() => applyDashboardSettings({}, {
        section: 'joinToCreate',
        enabled: 'on',
        triggerChannelId: 'voice-1',
        userLimitMax: '120',
    }, { channels }), /Maximum users must be between 1 and 99/);

    assert.equal(intField({ count: '' }, 'count', { fallback: 7 }), 7);
    assert.throws(() => intField({ count: 'abc' }, 'count', { label: 'Count' }), /Count must be a whole number/);
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
