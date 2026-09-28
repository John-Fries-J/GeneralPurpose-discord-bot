const { MessageFlags } = require('discord.js');
const language = require('../utils/language');
const { formatInteractionCommand, safeReply } = require('../utils/discord');
const { isCommandEnabled } = require('../utils/features');
const { memberCanUseCommand } = require('../utils/permissions');
const { addUserHistory, recordCommandUsage } = require('../utils/store');
const { handleHoneypotButton } = require('../utils/honeypot');
const { closeTicket, customIds: ticketCustomIds, deleteTicket, openTicket } = require('../utils/tickets');
const { handleRulesAgreementButton } = require('../utils/community');

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
        console.error(`No command matching ${interaction.commandName} was found.`);
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
    if (!interaction.guild) return false;

    if (await handleHoneypotButton(interaction)) return true;
    if (await handleRulesAgreementButton(interaction)) return true;

    if (interaction.customId === ticketCustomIds.open || interaction.customId === 'open_ticket') {
        await openTicket(interaction);
        return true;
    }
    if (interaction.customId === ticketCustomIds.close || interaction.customId === 'close_ticket') {
        await closeTicket(interaction);
        return true;
    }
    if (interaction.customId === ticketCustomIds.delete || interaction.customId === 'delete_ticket') {
        await deleteTicket(interaction);
        return true;
    }

    return false;
}

async function routeInteraction(interaction) {
    if (interaction.isChatInputCommand?.()) return runChatInputCommand(interaction);
    if (interaction.isUserContextMenuCommand?.() || interaction.isMessageContextMenuCommand?.()) return runApplicationCommand(interaction);
    if (interaction.isAutocomplete?.()) return runAutocomplete(interaction);

    if (interaction.isButton?.()) {
        const handled = await runButton(interaction);
        if (!handled) await replyUnknownComponent(interaction);
        return handled;
    }

    if (
        interaction.isModalSubmit?.()
        || interaction.isStringSelectMenu?.()
        || interaction.isUserSelectMenu?.()
        || interaction.isRoleSelectMenu?.()
        || interaction.isChannelSelectMenu?.()
        || interaction.isMentionableSelectMenu?.()
    ) {
        await replyUnknownComponent(interaction);
        return false;
    }

    return false;
}

module.exports = {
    routeInteraction,
    runAutocomplete,
    runApplicationCommand,
    runButton,
    runChatInputCommand,
};
