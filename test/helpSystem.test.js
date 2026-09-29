const test = require('node:test');
const assert = require('node:assert/strict');
const { ComponentType, MessageFlags } = require('discord.js');
const {
    createCategoryHelpPayload,
    createCommandHelpPayload,
    createMainHelpPayload,
    handleHelpButton,
    handleHelpStringSelect,
    helpCategoryButtonPrefix,
    helpCategoryCustomId,
    helpHomeCustomId,
} = require('../utils/helpSystem');

function command(name, description, category = 'Utility') {
    return {
        category,
        data: {
            name,
            description,
            toJSON: () => ({
                name,
                description,
                options: [],
            }),
        },
    };
}

function fakeInteraction() {
    return {
        client: {
            commands: new Map([
                ['ping', command('ping', 'Check bot latency.', 'Utility')],
                ['warn', command('warn', 'Warn a member.', 'moderation')],
            ]),
        },
        guild: { name: 'Marsden Server' },
        user: { id: 'admin' },
        inGuild: () => true,
    };
}

function firstContainer(payload) {
    assert.equal(payload.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
    assert.equal(payload.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
    assert.equal(payload.embeds, undefined);
    assert.equal(payload.components.length, 1);
    return payload.components[0].toJSON();
}

function componentIds(json) {
    const ids = [];
    const visit = component => {
        if (component.custom_id) ids.push(component.custom_id);
        for (const child of component.components || []) visit(child);
        if (component.accessory) visit(component.accessory);
    };
    visit(json);
    return ids;
}

test('help system renders Components V2 module navigation', () => {
    const payload = createMainHelpPayload(fakeInteraction());
    const json = firstContainer(payload);
    const serialized = JSON.stringify(json);

    assert.equal(json.type, ComponentType.Container);
    assert.match(serialized, /GeneralPurpose/);
    assert.match(serialized, /Utility/);
    assert.match(serialized, /moderation/);
    assert.ok(componentIds(json).includes(helpCategoryCustomId));
    assert.ok(componentIds(json).some(id => id.startsWith(helpCategoryButtonPrefix)));
});

test('help system renders Components V2 command detail', () => {
    const payload = createCommandHelpPayload(fakeInteraction(), 'ping');
    const json = firstContainer(payload);
    const serialized = JSON.stringify(json);

    assert.match(serialized, /\/ping/);
    assert.match(serialized, /Usage/);
    assert.match(serialized, /Utility/);
    assert.ok(componentIds(json).includes(helpHomeCustomId));
});

test('help system handles category select updates', async () => {
    const updates = [];
    const handled = await handleHelpStringSelect({
        ...fakeInteraction(),
        customId: 'help:category',
        values: ['moderation'],
        isStringSelectMenu: () => true,
        update: async payload => updates.push(payload),
    });

    assert.equal(handled, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].flags, MessageFlags.IsComponentsV2);
    assert.match(JSON.stringify(updates[0].components[0].toJSON()), /warn/);
});

test('help system handles back button updates', async () => {
    const updates = [];
    const handled = await handleHelpButton({
        ...fakeInteraction(),
        customId: helpHomeCustomId,
        isButton: () => true,
        update: async payload => updates.push(payload),
    });

    assert.equal(handled, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].flags, MessageFlags.IsComponentsV2);
    assert.match(JSON.stringify(updates[0].components[0].toJSON()), /Browse commands/);
});

test('help system hides missing command details', () => {
    const payload = createCommandHelpPayload(fakeInteraction(), 'missing');
    const json = firstContainer(payload);

    assert.match(JSON.stringify(json), /does not exist/i);
    assert.ok(componentIds(json).includes(helpHomeCustomId));
});
