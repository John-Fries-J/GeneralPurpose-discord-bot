const { MessageFlags } = require('discord.js');
const language = require('../utils/language');
const { formatInteractionCommand, safeReply } = require('../utils/discord');
const { isCommandEnabled } = require('../utils/features');
const { memberCanUseCommand } = require('../utils/permissions');
const { addUserHistory, recordCommandUsage } = require('../utils/store');
const { logger } = require('../utils/logger');
const { routeButtonInteraction } = require('./buttons');
const { isContextCommand, routeContextCommand } = require('./context');
const { routeModalInteraction } = require('./modals');
const { isSelectInteraction, routeSelectInteraction } = require('./selects');

const interactionLogger = logger.child({ component: 'interactions' });

function isEphemeralCapable(interaction) {
    return interaction.isRepliable?.() && !interaction.replied && !interaction.deferred;
}

async function replyUnknownComponent(interaction) {
    if (!isEphemeralCapable(interaction)) return;
    await interaction.reply({
        content: 'That control is no longer active. Run the command again to get a fresh one.',
        flags: MessageFlags.Ephemeral,
    }).catch(() => null);
}

function formatCommandHistorySummary(interaction) {
    if (interaction.isChatInputCommand?.()) return formatInteractionCommand(interaction);
    if (interaction.isUserContextMenuCommand?.()) return `${interaction.commandName} user:${interaction.targetUser?.tag || interaction.targetId}`;
    if (interaction.isMessageContextMenuCommand?.()) return `${interaction.commandName} message:${interaction.targetMessage?.id || interaction.targetId}`;
    return interaction.commandName;
}

async function runApplicationCommand(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        interactionLogger.warn('No command registered for interaction', {
            command: interaction.commandName,
            guildId: interaction.guildId,
            userId: interaction.user?.id,
        });
        return;
    }

    if (!isCommandEnabled(command)) {
        return interaction.reply({ content: 'That command is currently disabled.', flags: MessageFlags.Ephemeral });
    }

    if (!memberCanUseCommand(interaction, command)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
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
            summary: formatCommandHistorySummary(interaction),
            channelId: interaction.channelId,
            metadata: {
                command: interaction.commandName,
                ok: true,
            },
        }).catch(error => {
            interactionLogger.error('Failed to record command history', {
                command: interaction.commandName,
                guildId: interaction.guildId,
                userId: interaction.user?.id,
                error,
            });
        });
    } catch (error) {
        interactionLogger.error('Command execution failed', {
            command: interaction.commandName,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user?.id,
            error,
        });
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
            summary: `${formatCommandHistorySummary(interaction)} failed: ${error.message}`,
            channelId: interaction.channelId,
            metadata: {
                command: interaction.commandName,
                ok: false,
                error: error.message,
            },
        }).catch(() => null);
        await safeReply(interaction, { content: language.general.commandError, flags: MessageFlags.Ephemeral });
    }
}

async function runChatInputCommand(interaction) {
    return runApplicationCommand(interaction);
}

async function runAutocomplete(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return interaction.respond([]).catch(() => null);
    return command.autocomplete(interaction);
}

async function runButton(interaction) {
    return routeButtonInteraction(interaction);
}

async function runModal(interaction) {
    return routeModalInteraction(interaction);
}

async function runSelect(interaction) {
    return routeSelectInteraction(interaction);
}

async function routeInteraction(interaction) {
    if (interaction.isChatInputCommand?.()) return runChatInputCommand(interaction);
    if (isContextCommand(interaction)) return routeContextCommand(interaction, runApplicationCommand);
    if (interaction.isAutocomplete?.()) return runAutocomplete(interaction);

    if (interaction.isButton?.()) {
        const handled = await runButton(interaction);
        if (!handled) await replyUnknownComponent(interaction);
        return handled;
    }

    if (interaction.isModalSubmit?.()) {
        const handled = await runModal(interaction);
        if (!handled) await replyUnknownComponent(interaction);
        return handled;
    }

    if (isSelectInteraction(interaction)) {
        const handled = await runSelect(interaction);
        if (!handled) await replyUnknownComponent(interaction);
        return handled;
    }

    return false;
}

module.exports = {
    routeInteraction,
    runAutocomplete,
    runApplicationCommand,
    runButton,
    runChatInputCommand,
    runModal,
    runSelect,
};
