const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDatabase } = require('../database');
const moderationService = require('../services/moderation');
const { listModerationCases, listUserHistory } = require('../utils/store');

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

function createModerationInteraction(targetUser) {
    const targetMember = {
        user: targetUser,
        roles: { highest: { position: 1 } },
    };

    return {
        guild: {
            id: 'guild',
            name: 'Guild',
            ownerId: 'owner',
            channels: { cache: { get: () => null, find: () => null } },
            members: { fetch: async id => (id === targetUser.id ? targetMember : null) },
        },
        channelId: 'channel',
        user: { id: 'moderator', tag: 'Mod#0001' },
        member: { roles: { highest: { position: 10 } } },
    };
}

test('moderation service warn creates a case and history entry', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-mod-service-'));
    const restore = withEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: path.join(directory, 'state.sqlite'),
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });
    const targetUser = {
        id: 'target',
        tag: 'Target#0001',
        send: async () => null,
    };

    try {
        const result = await moderationService.warn(createModerationInteraction(targetUser), {
            user: targetUser,
            reason: 'Rule reminder',
        });
        const cases = await listModerationCases('guild', { userId: 'target' });
        const history = await listUserHistory('guild', 'target', 10);

        assert.equal(result.ok, true);
        assert.equal(cases.length, 1);
        assert.equal(cases[0].type, 'warn');
        assert.equal(history.length, 1);
        assert.equal(history[0].metadata.caseId, cases[0].id);
        assert.match(history[0].summary, /Rule reminder/);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
