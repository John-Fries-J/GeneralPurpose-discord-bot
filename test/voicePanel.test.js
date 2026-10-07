const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { upsertTempVoiceChannel } = require('../utils/store');
const { createVoicePanelPayload, handleVoicePanelButton, voicePanelCustomIds } = require('../utils/voicePanel');

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

test('createVoicePanelPayload shows persisted temporary voice channel details', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-voice-panel-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        await upsertTempVoiceChannel({
            guildId: 'guild',
            channelId: 'voice',
            ownerId: 'owner',
            name: 'Focus Room',
            locked: true,
            userLimit: 5,
            createdAt: 1_700_000_000_000,
        });

        const payload = await createVoicePanelPayload({
            member: {
                voice: {
                    channel: {
                        id: 'voice',
                        name: 'Focus Room',
                        userLimit: 5,
                        members: new Map([
                            ['owner', { id: 'owner', user: { bot: false } }],
                            ['guest', { id: 'guest', user: { bot: false } }],
                        ]),
                    },
                },
            },
        });
        const fields = Object.fromEntries(payload.embeds[0].data.fields.map(field => [field.name, field.value]));

        assert.equal(fields.Owner, '<@owner>');
        assert.equal(fields.Access, 'Locked');
        assert.match(fields.Users, /^2 \/ 5/);
        assert.equal(fields['User limit'], '5');
        assert.equal(fields.Created, '<t:1700000000:R>');
        assert.equal(payload.components.length, 5);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('voice panel delete button requires confirmation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-voice-panel-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        const channel = {
            id: '222222222222',
            name: 'Focus Room',
            members: new Map(),
        };
        const member = {
            id: '111111111111',
            user: { id: '111111111111', username: 'owner', bot: false },
            voice: { channel, channelId: channel.id },
        };
        channel.members.set(member.id, member);
        const guild = {
            id: '999999999999',
            channels: {
                cache: new Map([[channel.id, channel]]),
                fetch: async id => guild.channels.cache.get(id) || null,
            },
            members: {
                cache: new Map([[member.id, member]]),
                fetch: async id => guild.members.cache.get(id) || null,
            },
            roles: { everyone: { id: '999999999999' } },
        };

        await upsertTempVoiceChannel({
            guildId: guild.id,
            channelId: channel.id,
            ownerId: member.id,
            name: 'Focus Room',
            createdAt: Date.now(),
        });
        const replies = [];
        const handled = await handleVoicePanelButton({
            customId: voicePanelCustomIds.delete,
            client: {
                guilds: {
                    cache: new Map([[guild.id, guild]]),
                    fetch: async id => guild.id === id ? guild : null,
                },
            },
            guild,
            user: { id: member.id },
            member,
            isButton: () => true,
            reply: async payload => replies.push(payload),
        });

        assert.equal(handled, true);
        assert.match(replies[0].content, /Delete <#222222222222>/);
        assert.equal(replies[0].components[0].toJSON().components[0].custom_id, voicePanelCustomIds.confirmDelete);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
