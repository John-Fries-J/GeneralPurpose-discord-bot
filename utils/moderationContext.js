const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const moderationService = require('../services/moderation');
const { createEmbed } = require('./embeds');
const { safeReply, truncate } = require('./discord');

const moderationContextIds = {
    addNotePrefix: 'modctx:add-note:',
    actionModalPrefix: 'modctx:action-modal:',
    actionSelectPrefix: 'modctx:action:',
    cancelPrefix: 'modctx:cancel:',
    confirmPrefix: 'modctx:confirm:',
};

const moderationActions = {
    warn: {
        label: 'Warn',
        description: 'Record a warning and DM the user.',
        permission: PermissionFlagsBits.ModerateMembers,
    },
    mute: {
        label: 'Mute',
        description: 'Apply the configured mute role for a duration.',
        permission: PermissionFlagsBits.ModerateMembers,
        durationLabel: 'Duration',
        durationRequired: true,
    },
    kick: {
        label: 'Kick',
        description: 'Remove the user from the server.',
        permission: PermissionFlagsBits.KickMembers,
        destructive: true,
    },
    ban: {
        label: 'Ban',
        description: 'Ban the user from the server.',
        permission: PermissionFlagsBits.BanMembers,
        destructive: true,
        durationLabel: 'Duration (optional)',
    },
};

function createAddModeratorNoteModal(user) {
    const label = truncate(`Note for ${user.username || user.tag || user.id}`, 45);
    return new ModalBuilder()
        .setCustomId(`${moderationContextIds.addNotePrefix}${user.id}`)
        .setTitle('Add Moderator Note')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('note')
                .setLabel(label)
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true),
        ));
}

function createModerationActionComponents(user) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(`${moderationContextIds.actionSelectPrefix}${user.id}`)
        .setPlaceholder('Choose a moderation action')
        .addOptions(Object.entries(moderationActions).map(([value, action]) => (
            new StringSelectMenuOptionBuilder()
                .setLabel(action.label)
                .setDescription(action.description)
                .setValue(value)
        )));

    return [new ActionRowBuilder().addComponents(select)];
}

function createModerationActionModal(actionName, user) {
    const action = moderationActions[actionName];
    if (!action) return null;

    const components = [
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Reason')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(actionName === 'warn')
                .setPlaceholder('Explain why this action is being taken.'),
        ),
    ];

    if (action.durationLabel) {
        components.push(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('duration')
                .setLabel(action.durationLabel)
                .setStyle(TextInputStyle.Short)
                .setMaxLength(32)
                .setRequired(action.durationRequired === true)
                .setPlaceholder('10m, 2h, 3d, 1w'),
        ));
    }

    return new ModalBuilder()
        .setCustomId(`${moderationContextIds.actionModalPrefix}${actionName}:${user.id}`)
        .setTitle(`${action.label} ${truncate(user.username || user.tag || user.id, 32)}`)
        .addComponents(components);
}

function parseActionCustomId(customId, prefix) {
    if (!customId?.startsWith(prefix)) return null;
    const [actionName, userId] = customId.slice(prefix.length).split(':');
    if (!moderationActions[actionName] || !userId) return null;
    return { actionName, userId };
}

async function resolveUser(interaction, userId) {
    const fetchedUser = await interaction.client?.users?.fetch?.(userId).catch(() => null);
    if (fetchedUser) return fetchedUser;

    const member = await interaction.guild?.members?.fetch?.(userId).catch(() => null);
    return member?.user || { id: userId, tag: userId };
}

function hasPermission(interaction, permission) {
    return interaction.memberPermissions?.has?.(permission) === true
        || interaction.member?.permissions?.has?.(permission) === true;
}

function canModerate(interaction) {
    return hasPermission(interaction, PermissionFlagsBits.ModerateMembers);
}

function canUseAction(interaction, actionName) {
    const action = moderationActions[actionName];
    return action ? hasPermission(interaction, action.permission) : false;
}

async function showAddModeratorNoteModal(interaction) {
    await interaction.showModal(createAddModeratorNoteModal(interaction.targetUser));
}

async function showModerateUserInterface(interaction) {
    const user = interaction.targetUser;
    await interaction.reply({
        embeds: [createEmbed({
            title: `Moderate ${user.tag || user.username || user.id}`,
            description: 'Choose an action. Kick and ban require confirmation before the reason form opens.',
            color: 'orange',
            fields: [
                { name: 'Target', value: `<@${user.id}>`, inline: true },
                { name: 'User ID', value: user.id, inline: true },
            ],
        })],
        components: createModerationActionComponents(user),
        flags: MessageFlags.Ephemeral,
    });
}

async function showActionModal(interaction, actionName, user) {
    if (!canUseAction(interaction, actionName)) {
        await interaction.reply({ content: `You do not have permission to ${moderationActions[actionName].label.toLowerCase()} members.`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.showModal(createModerationActionModal(actionName, user));
}

async function replyWithDestructiveConfirmation(interaction, actionName, user) {
    const action = moderationActions[actionName];
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${moderationContextIds.confirmPrefix}${actionName}:${user.id}`)
            .setLabel(`Continue ${action.label}`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${moderationContextIds.cancelPrefix}${actionName}:${user.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
        content: `Confirm ${action.label.toLowerCase()} for **${user.tag || user.username || user.id}**. You will enter the reason next.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

function readOptionalField(fields, customId) {
    try {
        return fields.getTextInputValue(customId).trim();
    } catch {
        return '';
    }
}

async function runModerationAction(interaction, actionName, user) {
    const reason = readOptionalField(interaction.fields, 'reason');
    const duration = readOptionalField(interaction.fields, 'duration');

    if (interaction.deferReply && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const result = await moderationService[actionName](interaction, { user, reason, duration });
    if (!result.ok) {
        await safeReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
        return true;
    }

    const payload = { flags: MessageFlags.Ephemeral };
    if (result.content) payload.content = result.content;
    if (result.embed) payload.embeds = [result.embed];
    await safeReply(interaction, payload);
    return true;
}

async function handleModerationContextButton(interaction) {
    if (!interaction.isButton?.() || !interaction.guild) return false;

    const confirm = parseActionCustomId(interaction.customId, moderationContextIds.confirmPrefix);
    if (confirm) {
        const user = await resolveUser(interaction, confirm.userId);
        await showActionModal(interaction, confirm.actionName, user);
        return true;
    }

    const cancel = parseActionCustomId(interaction.customId, moderationContextIds.cancelPrefix);
    if (!cancel) return false;

    const payload = { content: 'Moderation action cancelled.', components: [] };
    if (interaction.update) {
        await interaction.update(payload);
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleModerationContextStringSelect(interaction) {
    if (!interaction.isStringSelectMenu?.() || !interaction.guild) return false;
    if (!interaction.customId.startsWith(moderationContextIds.actionSelectPrefix)) return false;

    const userId = interaction.customId.slice(moderationContextIds.actionSelectPrefix.length);
    const actionName = interaction.values?.[0];
    const action = moderationActions[actionName];
    if (!action) {
        await interaction.reply({ content: 'That moderation action is no longer available.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!canUseAction(interaction, actionName)) {
        await interaction.reply({ content: `You do not have permission to ${action.label.toLowerCase()} members.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    const user = await resolveUser(interaction, userId);
    if (action.destructive) {
        await replyWithDestructiveConfirmation(interaction, actionName, user);
        return true;
    }

    await interaction.showModal(createModerationActionModal(actionName, user));
    return true;
}

async function handleModerationContextModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.guild) return false;

    const actionSubmit = parseActionCustomId(interaction.customId, moderationContextIds.actionModalPrefix);
    if (actionSubmit) {
        if (!canUseAction(interaction, actionSubmit.actionName)) {
            await interaction.reply({ content: 'You do not have permission to use that moderation action.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const user = await resolveUser(interaction, actionSubmit.userId);
        return runModerationAction(interaction, actionSubmit.actionName, user);
    }

    if (!interaction.customId.startsWith(moderationContextIds.addNotePrefix)) return false;

    if (!canModerate(interaction)) {
        await interaction.reply({ content: 'You need Moderate Members to add moderator notes.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = interaction.customId.slice(moderationContextIds.addNotePrefix.length);
    const user = await resolveUser(interaction, userId);
    const noteText = interaction.fields.getTextInputValue('note').trim();
    if (!noteText) {
        await interaction.reply({ content: 'Moderator note cannot be empty.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const result = await moderationService.addNote(interaction, {
        user,
        note: noteText,
        source: 'context-menu',
    });

    await interaction.reply({
        content: result.ok ? result.content : result.message,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

module.exports = {
    createAddModeratorNoteModal,
    createModerationActionComponents,
    createModerationActionModal,
    handleModerationContextButton,
    handleModerationContextModal,
    handleModerationContextStringSelect,
    moderationContextIds,
    showAddModeratorNoteModal,
    showModerateUserInterface,
};
