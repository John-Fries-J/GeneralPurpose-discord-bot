const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const { upsertTempVoiceChannel, getTempVoiceChannel } = require('../utils/store');
const {
    VoiceControlError,
    getTemporaryVoiceState,
    lockOwnedVoiceChannel,
    rejectVoiceMember,
    renameOwnedVoiceChannel,
    setOwnedVoiceLimit,
    transferOwnedVoiceChannel,
} = require('../services/voiceControlService');

function withEnvironment(environment) {
    const previous = {};
    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    return () => {
        closeDatabase();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

function makeMember(id, channel = null) {
    return {
        id,
        displayName: id,
        user: { id, username: id, bot: false },
        voice: {
            channel,
            channelId: channel?.id || null,
            disconnect: async reason => {
                channel.disconnects.push({ id, reason });
                channel.members.delete(id);
            },
        },
    };
}

function makeGuild() {
    const channel = {
        id: '123456789100',
        name: 'Focus Room',
        userLimit: 0,
        members: new Map(),
        disconnects: [],
        overwrites: [],
        setNames: [],
        limits: [],
        deleted: false,
        setName: async name => {
            channel.name = name;
            channel.setNames.push(name);
        },
        setUserLimit: async limit => {
            channel.userLimit = limit;
            channel.limits.push(limit);
        },
        delete: async () => {
            channel.deleted = true;
        },
        permissionOverwrites: {
            edit: async (target, value) => {
                channel.overwrites.push({ target: target.id || target, value });
            },
        },
        send: async () => null,
    };
    const owner = makeMember('111111111111', channel);
    const guest = makeMember('222222222222', channel);
    const outsider = makeMember('333333333333', null);
    channel.members.set(owner.id, owner);
    channel.members.set(guest.id, guest);
    const members = new Map([[owner.id, owner], [guest.id, guest], [outsider.id, outsider]]);
    const guild = {
        id: '999999999999',
        name: 'Guild',
        roles: { everyone: { id: '999999999999' } },
        channels: {
            cache: new Map([[channel.id, channel]]),
            fetch: async id => guild.channels.cache.get(id) || null,
        },
        members: {
            me: { permissions: { has: () => true }, voice: { channelId: null } },
            cache: members,
            fetch: async id => members.get(id) || null,
        },
    };
    const client = {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async id => client.guilds.cache.get(id) || null,
        },
    };
    return { client, guild, channel, owner, guest, outsider };
}

async function withVoiceFixture(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-activity-voice-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const fixture = makeGuild();
    try {
        await upsertTempVoiceChannel({
            guildId: fixture.guild.id,
            channelId: fixture.channel.id,
            ownerId: fixture.owner.id,
            name: fixture.channel.name,
            locked: false,
            userLimit: 0,
            createdAt: Date.now(),
        });
        await callback(fixture);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('activity voice state shows owner channel details', async () => {
    await withVoiceFixture(async ({ client, guild, owner }) => {
        const state = await getTemporaryVoiceState(client, guild.id, owner.id);

        assert.equal(state.owned, true);
        assert.equal(state.channel.name, 'Focus Room');
        assert.equal(state.channel.memberCount, 2);
    });
});

test('activity voice controls reject unrelated member', async () => {
    await withVoiceFixture(async ({ client, guild, outsider }) => {
        await assert.rejects(
            renameOwnedVoiceChannel(client, guild.id, outsider.id, 'Nope'),
            error => error instanceof VoiceControlError && error.code === 'not_in_voice',
        );
    });
});

test('activity voice ownership is checked on every request', async () => {
    await withVoiceFixture(async ({ client, guild, channel, owner, guest }) => {
        await upsertTempVoiceChannel({
            guildId: guild.id,
            channelId: channel.id,
            ownerId: guest.id,
            name: channel.name,
            createdAt: Date.now(),
        });

        await assert.rejects(
            renameOwnedVoiceChannel(client, guild.id, owner.id, 'Stale Owner'),
            error => error instanceof VoiceControlError && error.code === 'not_owner',
        );
    });
});

test('activity voice mutation validation and lock updates persisted state', async () => {
    await withVoiceFixture(async ({ client, guild, channel, owner }) => {
        await assert.rejects(
            renameOwnedVoiceChannel(client, guild.id, owner.id, 'x'),
            error => error instanceof VoiceControlError && error.code === 'invalid_name',
        );
        await setOwnedVoiceLimit(client, guild.id, owner.id, 4);
        await lockOwnedVoiceChannel(client, guild.id, owner.id);

        const record = await getTempVoiceChannel(channel.id);
        assert.equal(channel.userLimit, 4);
        assert.equal(record.locked, true);
        assert.deepEqual(channel.overwrites.at(-1), { target: guild.roles.everyone.id, value: { Connect: false } });
    });
});

test('activity voice reject and transfer stay scoped to owned channel', async () => {
    await withVoiceFixture(async ({ client, guild, channel, owner, guest }) => {
        await rejectVoiceMember(client, guild.id, owner.id, guest.id);
        assert.equal(channel.overwrites.at(-1).target, guest.id);
        assert.equal(channel.overwrites.at(-1).value.Connect, false);

        const transferred = await transferOwnedVoiceChannel(client, guild.id, owner.id, guest.id);
        assert.equal(transferred.ownerId, guest.id);
    });
});
