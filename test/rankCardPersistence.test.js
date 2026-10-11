const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadStoreWithEnvironment(environment) {
    const previous = {};

    for (const [key, value] of Object.entries(environment)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }

    delete require.cache[require.resolve('../utils/store')];
    const store = require('../utils/store');
    const database = require('../database');

    return {
        store,
        database,
        restore() {
            database.closeDatabase();
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
            delete require.cache[require.resolve('../utils/store')];
        },
    };
}

test('rank-card preferences and server backgrounds persist in SQLite state', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-card-persistence-'));
    const sqlitePath = path.join(directory, 'state.sqlite');
    const { store, restore } = loadStoreWithEnvironment({
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_SQLITE_PATH: sqlitePath,
        DATABASE_JSON_PATH: path.join(directory, 'missing.json'),
    });

    try {
        await store.initializeStorage();
        await store.upsertRankCardPreference({
            guildId: 'guild',
            userId: 'user',
            backgroundType: 'custom',
            accentColor: '#60a5fa',
        });
        await store.upsertRankCardBackground({
            guildId: 'guild',
            backgroundId: 'midnight',
            name: 'Midnight',
            assetPath: path.join('backgrounds', 'guilds', 'guild', 'midnight.webp'),
            createdBy: 'admin',
        });

        const preference = await store.getRankCardPreference('guild', 'user');
        const backgrounds = await store.listRankCardBackgrounds('guild');
        const state = await store.readState();

        assert.equal(preference.backgroundType, 'custom');
        assert.equal(preference.accentColor, '#60a5fa');
        assert.equal(backgrounds.length, 1);
        assert.equal(backgrounds[0].name, 'Midnight');
        assert.equal(state.rankCardPreferences.length, 1);
        assert.equal(state.rankCardBackgrounds.length, 1);

        await store.deleteRankCardPreference('guild', 'user');
        await store.deleteRankCardBackground('guild', 'midnight');
        assert.equal(await store.getRankCardPreference('guild', 'user'), null);
        assert.deepEqual(await store.listRankCardBackgrounds('guild'), []);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
