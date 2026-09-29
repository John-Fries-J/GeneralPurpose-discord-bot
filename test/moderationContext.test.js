const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { routeInteraction } = require('../interactions/router');
const { createAddModeratorNoteModal, moderationContextIds } = require('../utils/moderationContext');
const { listModNotes, listUserHistory } = require('../utils/store');
const { createUserHistoryPayload } = require('../utils/userHistoryView');

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

test('createAddModeratorNoteModal encodes the target user id', () => {
    const modal = createAddModeratorNoteModal({
        id: 'target',
        username: 'A very long username that needs truncation for the modal label',
    }).toJSON();

    assert.equal(modal.custom_id, `${moderationContextIds.addNotePrefix}target`);
    assert.equal(modal.components[0].components[0].custom_id, 'note');
    assert.ok(modal.components[0].components[0].label.length <= 45);
});

test('routeInteraction persists moderator notes from context modal submits', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-modctx-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const replies = [];

    try {
        const handled = await routeInteraction({
            customId: `${moderationContextIds.addNotePrefix}target`,
            guild: {
                id: 'guild',
                members: {
                    fetch: async id => ({ user: { id, tag: 'Target#0001' } }),
                },
            },
            guildId: 'guild',
            channelId: 'channel',
            client: {
                users: {
                    fetch: async id => ({ id, tag: 'Target#0001' }),
                },
            },
            user: { id: 'moderator', tag: 'Mod#0001' },
            member: { permissions: { has: () => true } },
            fields: { getTextInputValue: () => 'Context note' },
            isChatInputCommand: () => false,
            isUserContextMenuCommand: () => false,
            isMessageContextMenuCommand: () => false,
            isAutocomplete: () => false,
            isButton: () => false,
            isModalSubmit: () => true,
            isStringSelectMenu: () => false,
            isUserSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            isChannelSelectMenu: () => false,
            isMentionableSelectMenu: () => false,
            reply: async payload => replies.push(payload),
        });

        const notes = await listModNotes('guild', 'target', 10);
        const history = await listUserHistory('guild', 'target', 10);

        assert.equal(handled, true);
        assert.equal(notes.length, 1);
        assert.equal(notes[0].note, 'Context note');
        assert.equal(history[0].metadata.source, 'context-menu');
        assert.match(replies[0].content, /^Saved mod note /);

        const payload = await createUserHistoryPayload('guild', { id: 'target', tag: 'Target#0001' });
        const description = payload.embeds[0].data.description;
        assert.equal(description.match(/Context note/g).length, 1);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
