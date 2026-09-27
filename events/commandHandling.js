const { Events, REST, Routes } = require('discord.js');
const { getConfig } = require('../utils/config');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const { clientId, guildId, token } = getConfig();

        if (!clientId || !guildId || !token) {
            console.warn('[COMMANDS] Missing clientId, guildId, or token. Slash commands were not refreshed.');
            return;
        }

        const commands = [...client.commands.values()].map(command => command.data.toJSON());
        const rest = new REST().setToken(token);

        try {
            console.log(`Started refreshing ${commands.length} application (/) commands.`);
            const data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands.`);
        } catch (error) {
            console.error('Failed to refresh application commands:', error);
        }
    },
};
