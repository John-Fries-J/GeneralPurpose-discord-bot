const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../database');
const store = require('../utils/store');
const {
    closeTicket,
    createTicketHeaderEmbed,
    createTicketControls,
    customIds,
    formatTranscriptLine,
    handleTicketButton,
    handleTicketUserSelect,
} = require('../utils/tickets');

function withEnvironment(environment) {
    const previous = {};
    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    return () => {
        database.closeDatabase();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    };
}

test('formatTranscriptLine includes message metadata, attachments, and embeds', () => {
    const line = formatTranscriptLine({
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        content: 'Hello',
        author: {
            id: '123',
            tag: 'User#0001',
        },
        attachments: new Map([
            ['a', { url: 'https://example.com/a.png' }],
        ]),
        embeds: [{}],
    });

    assert.match(line, /^\[2026-01-02T03:04:05\.000Z\] User#0001 \(123\): Hello/);
    assert.match(line, /Attachments: https:\/\/example\.com\/a\.png/);
    assert.match(line, /Embeds: 1/);
});

test('ticket controls expose persistent management actions', () => {
    const openControls = createTicketControls('open').map(row => row.toJSON());
    const closedControls = createTicketControls('closed').map(row => row.toJSON());
    const openIds = openControls.flatMap(row => row.components.map(component => component.custom_id));
    const closedIds = closedControls.flatMap(row => row.components.map(component => component.custom_id));

    assert.deepEqual(openIds, [
        customIds.claim,
        customIds.transcript,
        customIds.rename,
        customIds.close,
        customIds.addUser,
        customIds.removeUser,
    ]);
    assert.deepEqual(closedIds, [customIds.transcript, customIds.delete]);
});

test('createTicketHeaderEmbed shows persisted ticket identity and state', () => {
    const embed = createTicketHeaderEmbed({
        channelId: 'ticket-channel',
        openerId: 'opener',
        claimedById: 'mod',
        status: 'open',
        priority: 'high',
        tags: ['billing'],
        createdAt: 1_700_000_000_000,
    }, { title: 'Ticket Status' }).toJSON();
    const fields = Object.fromEntries(embed.fields.map(field => [field.name, field.value]));

    assert.equal(embed.title, 'Ticket Status');
    assert.equal(fields['Ticket #'], '<#ticket-channel>');
    assert.equal(fields['Opened by'], '<@opener>');
    assert.equal(fields['Claimed by'], '<@mod>');
    assert.equal(fields.Priority, 'high');
    assert.equal(fields.Created, '<t:1700000000:R>');
    assert.equal(fields.Tags, 'billing');
});


test('ticket close button opens a persistent close reason modal', async () => {
    const shown = [];

    const handled = await handleTicketButton({
        customId: customIds.close,
        guild: { id: 'guild' },
        isButton: () => true,
        showModal: async modal => shown.push(modal.toJSON()),
    });

    assert.equal(handled, true);
    assert.equal(shown[0].custom_id, customIds.closeModal);
});

test('closeTicket persists close reason and closed timestamp', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ticket-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const replies = [];
    const channel = {
        id: 'ticket-channel',
        name: 'ticket-user',
        topic: 'opener',
        permissionOverwrites: {
            set: async overwrites => {
                channel.overwrites = overwrites;
            },
        },
        setName: async name => {
            channel.name = name;
        },
    };

    try {
        await closeTicket({
            guild: {
                id: 'guild',
                roles: { everyone: { id: 'guild' } },
                channels: { cache: new Map() },
            },
            channel,
            user: { id: 'mod', tag: 'Mod#0001' },
            member: { permissions: { has: () => true } },
            reply: async payload => replies.push(payload),
        }, { reason: 'Resolved through modal' });

        const record = await store.getTicketRecord('ticket-channel');

        assert.equal(channel.name, 'closed-user');
        assert.equal(record.status, 'closed');
        assert.equal(record.closeReason, 'Resolved through modal');
        assert.equal(typeof record.closedAt, 'number');
        assert.equal(replies[0].components[0].toJSON().components[1].custom_id, customIds.delete);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('ticket user select adds selected user to ticket permissions', async () => {
    const edits = [];
    const replies = [];
    const channel = {
        id: 'ticket-channel',
        name: 'ticket-user',
        topic: 'opener',
        permissionOverwrites: {
            edit: async (id, permissions) => edits.push({ id, permissions }),
        },
    };

    const handled = await handleTicketUserSelect({
        customId: customIds.addUser,
        guild: {
            id: 'guild',
            channels: { cache: new Map() },
        },
        channel,
        user: { id: 'mod', tag: 'Mod#0001' },
        member: { permissions: { has: () => true } },
        values: ['target'],
        users: { get: id => ({ id, tag: 'Target#0001' }) },
        isUserSelectMenu: () => true,
        reply: async payload => replies.push(payload),
    });

    assert.equal(handled, true);
    assert.deepEqual(edits, [{
        id: 'target',
        permissions: {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        },
    }]);
    assert.equal(replies[0].content, '<@target> has been added to this ticket.');
});
