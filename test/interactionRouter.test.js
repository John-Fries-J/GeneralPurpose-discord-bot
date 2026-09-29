const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { closeDatabase } = require('../database');
const { routeInteraction } = require('../interactions/router');

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

test('routeInteraction replies gracefully to unknown modals', async () => {
    const replies = [];
    const handled = await routeInteraction({
        guild: { id: 'guild' },
        customId: 'old:modal',
        isChatInputCommand: () => false,
        isUserContextMenuCommand: () => false,
        isMessageContextMenuCommand: () => false,
        isAutocomplete: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        reply: async payload => replies.push(payload),
    });

    assert.equal(handled, false);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('routeInteraction replies gracefully to unknown select menus', async () => {
    const replies = [];
    const handled = await routeInteraction({
        guild: { id: 'guild' },
        customId: 'old:role-select',
        isChatInputCommand: () => false,
        isUserContextMenuCommand: () => false,
        isMessageContextMenuCommand: () => false,
        isAutocomplete: () => false,
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => true,
        isChannelSelectMenu: () => false,
        isMentionableSelectMenu: () => false,
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

test('routeInteraction executes user context commands through command routing', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-router-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const replies = [];
    let executed = false;

    try {
        await routeInteraction({
            commandName: 'User Information',
            guildId: 'guild',
            channelId: 'channel',
            targetUser: { id: 'target', tag: 'Target#0001' },
            user: { id: 'user', tag: 'User#0001' },
            client: {
                commands: new Map([['User Information', {
                    data: { name: 'User Information', toJSON: () => ({ name: 'User Information' }) },
                    execute: async interaction => {
                        executed = true;
                        await interaction.reply({ content: interaction.targetUser.id, flags: MessageFlags.Ephemeral });
                    },
                }]]),
            },
            isChatInputCommand: () => false,
            isUserContextMenuCommand: () => true,
            isMessageContextMenuCommand: () => false,
            inGuild: () => true,
            reply: async payload => replies.push(payload),
        });

        assert.equal(executed, true);
        assert.equal(replies[0].content, 'target');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('routeInteraction handles persistent music buttons through the central router', async () => {
    const replies = [];

    const handled = await routeInteraction({
        guild: { id: 'guild' },
        customId: 'music:queue',
        isChatInputCommand: () => false,
        isUserContextMenuCommand: () => false,
        isMessageContextMenuCommand: () => false,
        isAutocomplete: () => false,
        isButton: () => true,
        reply: async payload => replies.push(payload),
    });

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(replies[0].embeds.length, 1);
});

test('/voice panel returns a persistent interactive control panel', async () => {
    const command = require('../commands/utility/voice');
    const replies = [];

    await command.execute({
        options: { getSubcommand: () => 'panel' },
        reply: async payload => replies.push(payload),
    });

    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(replies[0].components.length, 5);
});
