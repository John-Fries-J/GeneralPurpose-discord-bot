const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

function purgeRuntimeModules() {
    for (const modulePath of [
        '../database',
        '../utils/store',
        '../utils/guildConfig',
        '../utils/tickets',
        '../utils/joinToCreate',
        '../utils/leveling',
        '../utils/logging',
        '../utils/setupWizard',
        '../commands/utility/welcome',
    ]) {
        delete require.cache[require.resolve(modulePath)];
    }
}

async function withGuildConfig(configPatch, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-guild-config-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const jsonPath = path.join(directory, 'state.json');
    const configModule = require('../utils/config');
    const originalGetConfig = configModule.getConfig;
    const originalGetStoredConfig = configModule.getStoredConfig;
    const config = {
        database: {
            provider: 'sqlite',
            sqlitePath,
            jsonPath,
        },
        logChannels: {},
        logging: {},
        tickets: {},
        joinToCreate: {},
        leveling: {},
        ...configPatch,
    };

    purgeRuntimeModules();
    configModule.getConfig = () => config;
    configModule.getStoredConfig = () => config;

    const database = require('../database');
    const guildConfig = require('../utils/guildConfig');

    try {
        return await callback({ database, guildConfig, sqlitePath });
    } finally {
        database.closeDatabase();
        guildConfig.resetGuildSettingsCache();
        configModule.getConfig = originalGetConfig;
        configModule.getStoredConfig = originalGetStoredConfig;
        purgeRuntimeModules();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('guild settings resolution preserves fallback order and explicit values', async () => {
    await withGuildConfig({
        welcomeID: 'global-welcome',
        WelcomeEmbed: {
            title: 'Global hello',
            description: 'Global {user}',
            footer: 'Global footer',
        },
        tickets: {
            channelId: 'global-ticket',
            categoryId: 'global-category',
            supportRoleId: 'global-support',
        },
        joinToCreate: {
            enabled: true,
            triggerChannelId: 'global-trigger',
            userLimitMax: 33,
            emptyGraceMs: 0,
        },
        leveling: {
            enabled: true,
            mode: 'both',
            textXpPerMessage: 5,
            voiceXpPerMinute: 6,
            cooldownSeconds: 7,
            roleRewards: [{ xp: 100, roleId: 'global-role' }],
        },
    }, async ({ guildConfig }) => {
        const inherited = await guildConfig.getGuildSettings('guild-a');
        assert.equal(inherited.welcomeID, 'global-welcome');
        assert.equal(inherited.tickets.channelId, 'global-ticket');
        assert.equal(inherited.joinToCreate.userLimitMax, 33);
        assert.equal(inherited.joinToCreate.emptyGraceMs, 0);
        assert.equal(inherited.leveling.textXpPerMessage, 5);

        await guildConfig.updateTicketSettings('guild-a', { channelId: 'guild-ticket' }, { actorId: 'admin', source: 'dashboard' });
        await guildConfig.updateLevelingSettings('guild-a', {
            enabled: false,
            textXpPerMessage: 0,
            roleRewards: [],
        }, { actorId: 'admin', source: 'dashboard' });

        const overridden = await guildConfig.getGuildSettings('guild-a');
        assert.equal(overridden.tickets.channelId, 'guild-ticket');
        assert.equal(overridden.tickets.categoryId, 'global-category');
        assert.equal(overridden.leveling.enabled, false);
        assert.equal(overridden.leveling.textXpPerMessage, 0);
        assert.deepEqual(overridden.leveling.roleRewards, []);
    });
});

test('guild settings persist across reopen and stay isolated by guild', async () => {
    await withGuildConfig({}, async ({ database, guildConfig }) => {
        await guildConfig.updateTicketSettings('guild-a', { channelId: 'ticket-a' }, { actorId: 'admin-a', source: 'dashboard' });
        await guildConfig.updateTicketSettings('guild-b', { channelId: 'ticket-b' }, { actorId: 'admin-b', source: 'dashboard' });

        database.closeDatabase();
        guildConfig.resetGuildSettingsCache();

        assert.equal((await guildConfig.getGuildSettings('guild-a')).tickets.channelId, 'ticket-a');
        assert.equal((await guildConfig.getGuildSettings('guild-b')).tickets.channelId, 'ticket-b');
    });
});

test('configuration audit records real changes, skips no-ops, and rejects secret keys', async () => {
    await withGuildConfig({
        welcomeID: 'welcome',
    }, async ({ guildConfig }) => {
        await guildConfig.updateWelcomeSettings('guild-a', {
            enabled: true,
            channelId: 'welcome',
        }, { actorId: 'admin', source: 'dashboard' });
        assert.equal((await guildConfig.listConfigAudit('guild-a', { limit: 10 })).length, 0);

        await guildConfig.updateWelcomeSettings('guild-a', {
            enabled: true,
            channelId: 'new-welcome',
        }, { actorId: 'admin', source: 'dashboard' });
        const audit = await guildConfig.listConfigAudit('guild-a', { limit: 10 });
        assert.equal(audit.length, 1);
        assert.equal(audit[0].actorId, 'admin');
        assert.equal(audit[0].source, 'dashboard');
        assert.equal(audit[0].section, 'welcome');
        assert.equal(audit[0].key, 'channelId');

        await assert.rejects(
            () => guildConfig.updateGuildSettings('guild-a', 'welcome', { clientSecret: 'do-not-store' }, { actorId: 'admin', source: 'dashboard' }),
            /Unsupported welcome setting/,
        );
        assert.doesNotMatch(JSON.stringify(await guildConfig.listConfigAudit('guild-a', { limit: 10 })), /do-not-store/);
    });
});

test('dashboard parser saves selected guild only and invalidates cache', async () => {
    await withGuildConfig({
        tickets: {
            channelId: 'global-ticket',
        },
    }, async ({ guildConfig }) => {
        const { parseDashboardSettings } = require('../web/services/dashboardConfig');
        const result = parseDashboardSettings({
            section: 'tickets',
            guildId: 'guild-b',
            ticketChannelId: 'text-1',
            ticketCategoryId: 'category-1',
            supportRoleId: 'role-1',
            allowTranscripts: 'on',
            allowUserAdding: 'on',
            allowClaiming: 'on',
            closeInactivityDays: '0',
        }, {
            channels: [
                { id: 'text-1', type: ChannelType.GuildText },
                { id: 'category-1', type: ChannelType.GuildCategory },
            ],
            roles: [{ id: 'role-1' }],
        });

        await guildConfig.getGuildSettings('guild-a');
        await guildConfig.updateGuildSettings('guild-a', result.section, result.values, { actorId: 'admin', source: 'dashboard' });

        assert.equal((await guildConfig.getGuildSettings('guild-a')).tickets.channelId, 'text-1');
        assert.equal((await guildConfig.getGuildSettings('guild-b')).tickets.channelId, 'global-ticket');
    });
});

test('setup saves guild-specific values through shared config service', async () => {
    await withGuildConfig({}, async ({ guildConfig }) => {
        const { createDraft, saveSetupDraft } = require('../utils/setupWizard');
        const draft = createDraft(await guildConfig.getGuildSettings('guild-a'), 0);
        draft.voice.enabled = true;
        draft.voice.triggerChannelId = 'voice-trigger';
        draft.voice.categoryId = 'voice-category';
        draft.voice.userLimitMax = 12;
        const guild = {
            id: 'guild-a',
            channels: {
                cache: new Map([
                    ['voice-trigger', { id: 'voice-trigger', guildId: 'guild-a', type: ChannelType.GuildVoice }],
                    ['voice-category', { id: 'voice-category', guildId: 'guild-a', type: ChannelType.GuildCategory }],
                ]),
                fetch: async id => guild.channels.cache.get(id) || null,
            },
        };

        const message = await saveSetupDraft({
            guild,
            guildId: 'guild-a',
            user: { id: 'setup-admin' },
        }, 'voice', draft);

        assert.equal(message, 'Temporary voice settings saved.');
        assert.equal((await guildConfig.getGuildSettings('guild-a')).joinToCreate.triggerChannelId, 'voice-trigger');

        const audit = await guildConfig.listConfigAudit('guild-a', { limit: 10 });
        assert.equal(audit[0].source, 'discord_setup');
        assert.equal(audit[0].actorId, 'setup-admin');
    });
});

test('runtime helpers resolve guild overrides for covered modules', async () => {
    await withGuildConfig({}, async ({ guildConfig }) => {
        await guildConfig.updateWelcomeSettings('guild-a', {
            enabled: true,
            channelId: 'welcome-a',
            title: 'Guild Welcome',
            description: 'Hi {username}',
            footer: '',
        }, { actorId: 'admin', source: 'dashboard' });
        await guildConfig.updateLoggingSettings('guild-a', {
            channels: { moderation: 'log-a' },
        }, { actorId: 'admin', source: 'dashboard' });
        await guildConfig.updateTicketSettings('guild-a', {
            categoryId: 'ticket-category-a',
            supportRoleId: 'support-a',
        }, { actorId: 'admin', source: 'dashboard' });
        await guildConfig.updateJoinToCreateSettings('guild-a', {
            enabled: true,
            triggerChannelId: 'voice-a',
        }, { actorId: 'admin', source: 'dashboard' });
        await guildConfig.updateLevelingSettings('guild-a', {
            enabled: true,
            mode: 'voice',
            voiceXpPerMinute: 0,
        }, { actorId: 'admin', source: 'dashboard' });

        const { buildWelcomeEmbed } = require('../commands/utility/welcome');
        const { getLogChannel } = require('../utils/logging');
        const { getGuildTicketConfig } = require('../utils/tickets');
        const { getGuildJoinToCreateConfig } = require('../utils/joinToCreate');
        const { getGuildLevelingConfig } = require('../utils/leveling');
        const effective = await guildConfig.getGuildSettings('guild-a');
        const sent = [];
        const logChannel = { id: 'log-a', name: 'logs', send: payload => sent.push(payload) };
        const guild = {
            id: 'guild-a',
            name: 'Guild A',
            channels: {
                cache: {
                    get: id => (id === 'log-a' ? logChannel : null),
                    find: () => null,
                },
            },
        };

        const embed = buildWelcomeEmbed({ id: 'user', username: 'Mars' }, guild, effective.WelcomeEmbed);
        assert.equal(embed.data.title, 'Guild Welcome');
        assert.match(embed.data.description, /Mars/);
        assert.equal(getLogChannel(guild, 'moderation', effective), logChannel);
        assert.equal((await getGuildTicketConfig('guild-a')).supportRoleId, 'support-a');
        assert.equal((await getGuildJoinToCreateConfig('guild-a')).triggerChannelId, 'voice-a');
        assert.equal((await getGuildLevelingConfig('guild-a')).voiceXpPerMinute, 0);
    });
});
