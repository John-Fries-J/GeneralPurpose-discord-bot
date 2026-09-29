const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createCategoryHelpPayload,
    createCommandHelpPayload,
    createMainHelpPayload,
    handleHelpStringSelect,
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
        user: { id: 'admin' },
        inGuild: () => true,
    };
}

test('help system renders category navigation', () => {
    const payload = createMainHelpPayload(fakeInteraction());

    assert.equal(payload.components.length, 1);
    assert.match(payload.embeds[0].data.description, /Choose a category/);
    assert.match(payload.embeds[0].data.fields.map(field => field.name).join(','), /Utility/);
    assert.match(payload.embeds[0].data.fields.map(field => field.name).join(','), /moderation/);
});

test('help system renders command detail', () => {
    const payload = createCommandHelpPayload(fakeInteraction(), 'ping');

    assert.match(payload.embeds[0].data.title, /\/ping/);
    assert.match(payload.embeds[0].data.fields.find(field => field.name === 'Usage').value, /\/ping/);
    assert.match(payload.embeds[0].data.fields.find(field => field.name === 'Module').value, /Utility/);
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
    assert.match(updates[0].embeds[0].data.title, /moderation Commands/);
});

test('help system hides missing command details', () => {
    const payload = createCommandHelpPayload(fakeInteraction(), 'missing');

    assert.equal(payload.flags !== undefined, true);
    assert.match(payload.content, /does not exist/i);
});
