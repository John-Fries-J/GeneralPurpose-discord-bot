const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { formatVoiceChannelName, reconcileGuildTempVoiceChannels } = require('../utils/joinToCreate');

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

test('formatVoiceChannelName supports username and display name placeholders', () => {
    const member = {
        displayName: 'Mars',
        user: {
            username: 'marsden',
        },
    };

    assert.equal(formatVoiceChannelName('{displayName} / {username}', member), 'Mars / marsden');
});

test('formatVoiceChannelName supports username aliases', () => {
    const member = {
        id: '123',
        displayName: 'Mars',
        user: {
            globalName: 'Marsden',
            tag: 'marsden#0001',
            username: 'marsden',
        },
    };

    assert.equal(formatVoiceChannelName("{user}'s epic call", member), "marsden's epic call");
    assert.equal(formatVoiceChannelName('{globalName}', member), 'Marsden');
});

test('reconcileGuildTempVoiceChannels cleans stale records and transfers missing owners', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-jtc-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const { listTempVoiceChannelsForGuild, upsertTempVoiceChannel } = require('../utils/store');

    const makeMember = id => ({ id, joinedTimestamp: Number(id.replace(/\D/g, '')) || 0, user: { bot: false } });
    const makeChannel = (id, members = []) => {
        const channel = {
            id,
            name: id,
            userLimit: 0,
            members: new Map(members.map(member => [member.id, member])),
            deleted: false,
            delete: async () => {
                channel.deleted = true;
            },
            permissionOverwrites: {
                edits: [],
                edit: async (target, value) => {
                    channel.permissionOverwrites.edits.push({ target, value });
                },
            },
            send: async () => null,
        };
        return channel;
    };

    const owner = makeMember('user-1');
    const nextOwner = makeMember('user-2');
    const empty = makeChannel('empty');
    const occupied = makeChannel('occupied', [owner]);
    const transfer = makeChannel('transfer', [nextOwner]);
    const channels = new Map([
        [empty.id, empty],
        [occupied.id, occupied],
        [transfer.id, transfer],
    ]);
    const guild = {
        id: 'guild',
        channels: {
            cache: channels,
            fetch: async id => channels.get(id) || null,
        },
        members: {
            me: null,
            fetchMe: async () => null,
        },
    };

    try {
        for (const channelId of ['missing', 'empty', 'occupied', 'transfer']) {
            await upsertTempVoiceChannel({
                guildId: 'guild',
                channelId,
                ownerId: 'user-1',
                createdAt: Date.now(),
            });
        }

        const result = await reconcileGuildTempVoiceChannels(guild);
        const remaining = await listTempVoiceChannelsForGuild('guild');

        assert.equal(result.records, 4);
        assert.equal(result.removed, 2);
        assert.equal(result.preserved, 1);
        assert.equal(result.transferred, 1);
        assert.equal(empty.deleted, true);
        assert.deepEqual(remaining.map(record => record.channelId).sort(), ['occupied', 'transfer']);
        assert.equal(remaining.find(record => record.channelId === 'transfer').ownerId, 'user-2');
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
