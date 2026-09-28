const { Events } = require('discord.js');
const language = require('../utils/language');
const { formatInteractionCommand, safeReply } = require('../utils/discord');
const { isCommandEnabled } = require('../utils/features');
const { memberCanUseCommand } = require('../utils/permissions');
const { addUserHistory, recordCommandUsage } = require('../utils/store');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        if (!isCommandEnabled(command)) {
            return interaction.reply({ content: 'That command is currently disabled.', flags: 64 });
        }

        if (!memberCanUseCommand(interaction, command)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        try {
            await command.execute(interaction);
            await recordCommandUsage({
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                command: interaction.commandName,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                ok: true,
            });
            await addUserHistory({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                type: 'command',
                summary: formatInteractionCommand(interaction),
                channelId: interaction.channelId,
                metadata: {
                    command: interaction.commandName,
                    ok: true,
                },
            }).catch(error => {
                console.error('Failed to record command history:', error);
            });
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            await recordCommandUsage({
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                command: interaction.commandName,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                ok: false,
                error: error.message,
            }).catch(() => null);
            await addUserHistory({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                type: 'command:error',
                summary: `${formatInteractionCommand(interaction)} failed: ${error.message}`,
                channelId: interaction.channelId,
                metadata: {
                    command: interaction.commandName,
                    ok: false,
                    error: error.message,
                },
            }).catch(() => null);
            await safeReply(interaction, { content: language.general.commandError, flags: 64 });
        }
    },
};
