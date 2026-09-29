const test = require('node:test');
const assert = require('node:assert/strict');
const { ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const { loadCommands } = require('../utils/commands');

const userInstallCommands = new Set(['ping', 'remindme']);

function commandJson() {
    return loadCommands().map(({ command, filePath }) => ({
        category: command.category,
        filePath,
        json: command.data.toJSON(),
    }));
}

test('all application commands declare explicit contexts and integration types', () => {
    for (const { filePath, json } of commandJson()) {
        assert.ok(Array.isArray(json.contexts), `${filePath} must declare contexts`);
        assert.ok(json.contexts.length > 0, `${filePath} must declare at least one context`);
        assert.ok(Array.isArray(json.integration_types), `${filePath} must declare integration types`);
        assert.ok(json.integration_types.length > 0, `${filePath} must declare at least one integration type`);
    }
});

test('server management commands remain guild-only and guild-installed', () => {
    const restrictedCategories = new Set(['config', 'context', 'moderation', 'suggestions', 'ticket']);

    for (const { category, filePath, json } of commandJson()) {
        if (!restrictedCategories.has(String(category || '').toLowerCase())) continue;

        assert.deepEqual(json.contexts, [InteractionContextType.Guild], `${filePath} must be guild-only`);
        assert.deepEqual(json.integration_types, [ApplicationIntegrationType.GuildInstall], `${filePath} must be guild-installed only`);
    }
});

test('only explicitly selected utility commands support user installation', () => {
    for (const { filePath, json } of commandJson()) {
        const userInstallable = json.integration_types.includes(ApplicationIntegrationType.UserInstall);

        assert.equal(userInstallable, userInstallCommands.has(json.name), `${filePath} has unexpected user-install policy`);
        if (userInstallable) {
            assert.deepEqual(json.contexts, [
                InteractionContextType.Guild,
                InteractionContextType.BotDM,
                InteractionContextType.PrivateChannel,
            ]);
        }
    }
});
