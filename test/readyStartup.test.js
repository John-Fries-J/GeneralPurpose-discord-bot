const test = require('node:test');
const assert = require('node:assert/strict');

test('ready startup exits when storage initialization fails', async () => {
    const store = require('../utils/store');
    const readyPath = require.resolve('../events/ready');
    const originalInitializeStorage = store.initializeStorage;
    delete require.cache[readyPath];

    let destroyed = false;
    let exitCode = null;
    store.initializeStorage = async () => {
        throw new Error('migration failed');
    };

    try {
        const ready = require('../events/ready');
        const ok = await ready.initializeReadyStorage({
            destroy: () => {
                destroyed = true;
            },
        }, code => {
            exitCode = code;
        });

        assert.equal(ok, false);
        assert.equal(destroyed, true);
        assert.equal(exitCode, 1);
    } finally {
        store.initializeStorage = originalInitializeStorage;
        process.exitCode = undefined;
        delete require.cache[readyPath];
    }
});
