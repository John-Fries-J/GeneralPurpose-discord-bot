const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { upsertTempVoiceChannel } = require('../utils/store');
const { createVoicePanelPayload } = require('../utils/voicePanel');

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
