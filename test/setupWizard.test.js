const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applySetupDraftToConfig,
    createDraft,
    createSetupPayload,
    handleSetupStringSelect,
    resetSetupDrafts,
} = require('../utils/setupWizard');

function fakeInteraction() {
    return {
        guildId: 'guild',
        guild: { id: 'guild' },
        user: { id: 'admin' },
    };
}

test('setup wizard creates a draft from existing config', () => {
    const draft = createDraft({
        welcomeID: 'welcome-channel',
        WelcomeEmbed: {
            title: 'Hello',
            description: 'Hi {user}',
        },
        logChannels: {
            moderation: 'mod-logs',
        },
        tickets: {
            channelId: 'ticket-panel',
            supportRoleId: 'support',
        },
        joinToCreate: {
            enabled: true,
            triggerChannelId: 'voice-trigger',
        },
        leveling: {
            enabled: true,
            mode: 'voice',
        },
    }, 0);

    assert.equal(draft.welcome.enabled, true);
    assert.equal(draft.welcome.channelId, 'welcome-channel');
    assert.equal(draft.logging.channels.moderation, 'mod-logs');
    assert.equal(draft.tickets.supportRoleId, 'support');
    assert.equal(draft.voice.triggerChannelId, 'voice-trigger');
    assert.equal(draft.leveling.mode, 'voice');
});

test('setup wizard applies section drafts to config objects', () => {
    const draft = createDraft({}, 0);
    draft.welcome.enabled = true;
    draft.welcome.channelId = 'welcome-channel';
    draft.logging.channels.moderation = 'mod-logs';
    draft.tickets.channelId = 'tickets';
    draft.tickets.categoryId = 'category';
    draft.tickets.supportRoleId = 'support';
    draft.voice.enabled = true;
    draft.voice.triggerChannelId = 'voice';
    draft.leveling.enabled = true;
    draft.leveling.mode = 'both';

    const config = {};
    assert.equal(applySetupDraftToConfig(config, 'welcome', draft), 'Welcome settings saved.');
    assert.equal(applySetupDraftToConfig(config, 'logging', draft), 'Logging settings saved.');
    assert.equal(applySetupDraftToConfig(config, 'tickets', draft), 'Ticket settings saved.');
    assert.equal(applySetupDraftToConfig(config, 'voice', draft), 'Temporary voice settings saved.');
    assert.equal(applySetupDraftToConfig(config, 'leveling', draft), 'Leveling settings saved.');

    assert.equal(config.welcomeID, 'welcome-channel');
    assert.equal(config.logChannels.moderation, 'mod-logs');
    assert.equal(config.tickets.supportRoleId, 'support');
    assert.equal(config.joinToCreate.enabled, true);
    assert.equal(config.leveling.mode, 'both');
});

test('setup wizard renders ephemeral section payloads and updates draft controls', async () => {
    resetSetupDrafts();
    const interaction = fakeInteraction();
    const payload = createSetupPayload(interaction, 'leveling');

    assert.equal(payload.flags !== undefined, true);
    assert.equal(payload.components.length, 3);
    assert.match(payload.embeds[0].data.title, /Leveling Setup/);

    const updates = [];
    const handled = await handleSetupStringSelect({
        ...interaction,
        customId: 'setup:string:leveling-mode',
        values: ['voice'],
        isStringSelectMenu: () => true,
        update: async updatePayload => updates.push(updatePayload),
    });

    assert.equal(handled, true);
    assert.equal(updates.length, 1);
    assert.match(updates[0].embeds[0].data.fields.find(field => field.name === 'Mode').value, /voice/);
});
