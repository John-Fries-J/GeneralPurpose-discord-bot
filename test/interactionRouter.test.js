const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { routeInteraction } = require('../interactions/router');

test('routeInteraction replies gracefully to unknown buttons', async () => {
    const replies = [];
    const handled = await routeInteraction({
        guild: { id: 'guild' },
        customId: 'unknown:button',
        isChatInputCommand: () => false,
        isAutocomplete: () => false,
        isButton: () => true,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        reply: async payload => replies.push(payload),
    });

    assert.equal(handled, false);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('routeInteraction returns empty autocomplete choices for commands without handlers', async () => {
    const responses = [];
    await routeInteraction({
        commandName: 'ping',
        client: { commands: new Map([['ping', {}]]) },
        isChatInputCommand: () => false,
        isAutocomplete: () => true,
        respond: async choices => responses.push(choices),
    });

    assert.deepEqual(responses, [[]]);
});
