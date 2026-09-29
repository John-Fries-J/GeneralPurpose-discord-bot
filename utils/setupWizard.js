const { ChannelType, MessageFlags, PermissionFlagsBits, TextInputStyle } = require('discord.js');
const { getConfig, updateConfig } = require('./config');
const { createEmbed } = require('./embeds');
const {
    channelSelect,
    modal,
    primaryButton,
    roleSelect,
    row,
    secondaryButton,
    stringSelect,
    successButton,
    textInput,
} = require('./discordComponents');

const setupPrefix = 'setup:';
const draftMaxAgeMs = 15 * 60 * 1000;
const drafts = new Map();

const logCategories = [
    ['logChannel', 'Default logs'],
    ['moderation', 'Moderation'],
    ['ticket', 'Tickets'],
    ['suggestion', 'Suggestions'],
    ['messageDelete', 'Message deletes'],
    ['editMessage', 'Message edits'],
    ['directMessage', 'Direct messages'],
];

function cleanupDrafts(now = Date.now()) {
    for (const [key, draft] of drafts.entries()) {
        if (Number(draft.expiresAt || 0) <= now) drafts.delete(key);
    }
}

function draftKey(interaction) {
    return `${interaction.guildId || interaction.guild?.id || 'guild'}:${interaction.user?.id || 'user'}`;
}

function createDraft(config = getConfig(), now = Date.now()) {
    const tickets = config.tickets || {};
    const voice = config.joinToCreate || {};
    const leveling = config.leveling || {};

    return {
        expiresAt: now + draftMaxAgeMs,
        section: 'main',
        welcome: {
            enabled: Boolean(config.welcomeID),
            channelId: config.welcomeID || '',
            title: config.WelcomeEmbed?.title || 'Welcome',
            description: config.WelcomeEmbed?.description || 'Welcome {user} to {server}.',
        },
        logging: {
            activeCategory: 'logChannel',
            channels: { ...(config.logChannels || {}) },
        },
        tickets: {
            channelId: tickets.channelId || config.ticketChannelId || '',
            categoryId: tickets.categoryId || config.ticketCategoryId || '',
            supportRoleId: tickets.supportRoleId || config.ticketRole || '',
            allowTranscripts: tickets.allowTranscripts !== false,
            allowUserAdding: tickets.allowUserAdding !== false,
            allowClaiming: tickets.allowClaiming !== false,
        },
        voice: {
            enabled: voice.enabled === true,
            triggerChannelId: voice.triggerChannelId || '',
            categoryId: voice.categoryId || '',
            nameFormat: voice.nameFormat || "{username}'s Channel",
            userLimitMax: Number(voice.userLimitMax || 25),
        },
        leveling: {
            enabled: leveling.enabled === true,
            mode: ['text', 'voice', 'both'].includes(leveling.mode) ? leveling.mode : 'both',
        },
    };
}

function getDraft(interaction) {
    cleanupDrafts();
    const key = draftKey(interaction);
    const existing = drafts.get(key);
    if (existing) {
        existing.expiresAt = Date.now() + draftMaxAgeMs;
        return existing;
    }

    const draft = createDraft();
    drafts.set(key, draft);
    return draft;
}

function resetSetupDrafts() {
    drafts.clear();
}

function boolOptions(enabledLabel = 'Enabled', disabledLabel = 'Disabled', value = false) {
    return [
        { label: enabledLabel, value: 'enabled', default: value === true },
        { label: disabledLabel, value: 'disabled', default: value !== true },
    ];
}

function setupEmbed(title, description, fields = [], color = 'blue') {
    return createEmbed({
        title,
        description,
        fields,
        color,
    });
}

function mainPayload(draft, notice = '') {
    draft.section = 'main';
    return {
        embeds: [setupEmbed(
            'GeneralPurpose Setup',
            `${notice ? `${notice}\n\n` : ''}Choose what you want to configure. Changes are kept as a short-lived draft until you press Save.`,
            [
                { name: 'Welcome', value: draft.welcome.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Tickets', value: draft.tickets.channelId ? 'Panel selected' : 'Not configured', inline: true },
                { name: 'Temporary Voice', value: draft.voice.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Leveling', value: draft.leveling.enabled ? draft.leveling.mode : 'Disabled', inline: true },
            ],
        )],
        components: [
            row(
                primaryButton('setup:open:welcome', 'Welcome'),
                primaryButton('setup:open:logging', 'Logging'),
                primaryButton('setup:open:tickets', 'Tickets'),
                primaryButton('setup:open:voice', 'Temporary Voice'),
                primaryButton('setup:open:leveling', 'Leveling'),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function sectionActions(section) {
    return row(
        successButton(`setup:save:${section}`, 'Save'),
        secondaryButton('setup:back', 'Back'),
    );
}

function welcomePayload(draft, notice = '') {
    draft.section = 'welcome';
    return {
        embeds: [setupEmbed('Welcome Setup', notice || 'Choose a channel, edit the message, then save.', [
            { name: 'Enabled', value: draft.welcome.enabled ? 'Yes' : 'No', inline: true },
            { name: 'Channel', value: draft.welcome.channelId ? `<#${draft.welcome.channelId}>` : 'Not selected', inline: true },
            { name: 'Title', value: draft.welcome.title || 'Not set' },
            { name: 'Message', value: draft.welcome.description.slice(0, 1024) || 'Not set' },
            { name: 'Placeholders', value: '{user}, {username}, {server}, {memberCount}' },
        ])],
        components: [
            row(stringSelect('setup:string:welcome-enabled', 'Welcome messages', boolOptions('Welcome on', 'Welcome off', draft.welcome.enabled))),
            row(channelSelect('setup:channel:welcome', 'Welcome channel', [ChannelType.GuildText, ChannelType.GuildAnnouncement])),
            row(primaryButton('setup:modal:welcome-message', 'Edit Message')),
            sectionActions('welcome'),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function loggingPayload(draft, notice = '') {
    draft.section = 'logging';
    const active = draft.logging.activeCategory;
    const activeLabel = logCategories.find(([value]) => value === active)?.[1] || active;
    const fields = logCategories.map(([value, label]) => ({
        name: label,
        value: draft.logging.channels[value] ? `<#${draft.logging.channels[value]}>` : 'Not set',
        inline: true,
    }));

    return {
        embeds: [setupEmbed('Logging Setup', notice || `Selected category: ${activeLabel}`, fields)],
        components: [
            row(stringSelect('setup:string:logging-category', 'Log category', logCategories.map(([value, label]) => ({ value, label, default: value === active })))),
            row(channelSelect('setup:channel:logging', `Channel for ${activeLabel}`, [ChannelType.GuildText, ChannelType.GuildAnnouncement])),
            sectionActions('logging'),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function ticketPayload(draft, notice = '') {
    draft.section = 'tickets';
    const controlOptions = [
        { label: 'Transcripts', value: 'allowTranscripts', default: draft.tickets.allowTranscripts },
        { label: 'User adding', value: 'allowUserAdding', default: draft.tickets.allowUserAdding },
        { label: 'Claiming', value: 'allowClaiming', default: draft.tickets.allowClaiming },
    ];

    return {
        embeds: [setupEmbed('Ticket Setup', notice || 'Select the ticket panel channel, category, support role, and controls.', [
            { name: 'Panel channel', value: draft.tickets.channelId ? `<#${draft.tickets.channelId}>` : 'Not selected', inline: true },
            { name: 'Ticket category', value: draft.tickets.categoryId ? `<#${draft.tickets.categoryId}>` : 'Not selected', inline: true },
            { name: 'Support role', value: draft.tickets.supportRoleId ? `<@&${draft.tickets.supportRoleId}>` : 'Not selected', inline: true },
            { name: 'Controls', value: controlOptions.filter(option => option.default).map(option => option.label).join(', ') || 'None' },
        ])],
        components: [
            row(channelSelect('setup:channel:tickets-panel', 'Panel channel', [ChannelType.GuildText, ChannelType.GuildAnnouncement])),
            row(channelSelect('setup:channel:tickets-category', 'Ticket category', [ChannelType.GuildCategory])),
            row(roleSelect('setup:role:tickets-support', 'Support role')),
            row(stringSelect('setup:string:tickets-controls', 'Ticket controls', controlOptions, { minValues: 0, maxValues: controlOptions.length })),
            sectionActions('tickets'),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function voicePayload(draft, notice = '') {
    draft.section = 'voice';
    return {
        embeds: [setupEmbed('Temporary Voice Setup', notice || 'Configure join-to-create voice channels.', [
            { name: 'Enabled', value: draft.voice.enabled ? 'Yes' : 'No', inline: true },
            { name: 'Trigger channel', value: draft.voice.triggerChannelId ? `<#${draft.voice.triggerChannelId}>` : 'Not selected', inline: true },
            { name: 'Category', value: draft.voice.categoryId ? `<#${draft.voice.categoryId}>` : 'Trigger category', inline: true },
            { name: 'Name format', value: draft.voice.nameFormat },
            { name: 'Maximum users', value: `${draft.voice.userLimitMax}`, inline: true },
        ])],
        components: [
            row(stringSelect('setup:string:voice-enabled', 'Join-to-create', boolOptions('Join-to-create on', 'Join-to-create off', draft.voice.enabled))),
            row(channelSelect('setup:channel:voice-trigger', 'Trigger voice channel', [ChannelType.GuildVoice, ChannelType.GuildStageVoice])),
            row(channelSelect('setup:channel:voice-category', 'Temporary channel category', [ChannelType.GuildCategory], { minValues: 0 })),
            row(primaryButton('setup:modal:voice-options', 'Edit Options')),
            sectionActions('voice'),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function levelingPayload(draft, notice = '') {
    draft.section = 'leveling';
    return {
        embeds: [setupEmbed('Leveling Setup', notice || 'Choose the XP mode and save.', [
            { name: 'Enabled', value: draft.leveling.enabled ? 'Yes' : 'No', inline: true },
            { name: 'Mode', value: draft.leveling.mode, inline: true },
        ])],
        components: [
            row(stringSelect('setup:string:leveling-enabled', 'Leveling', boolOptions('Leveling on', 'Leveling off', draft.leveling.enabled))),
            row(stringSelect('setup:string:leveling-mode', 'Leveling mode', [
                { label: 'Text', value: 'text', default: draft.leveling.mode === 'text' },
                { label: 'Voice', value: 'voice', default: draft.leveling.mode === 'voice' },
                { label: 'Both', value: 'both', default: draft.leveling.mode === 'both' },
            ])),
            sectionActions('leveling'),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function createSetupPayload(interaction, section = 'main', notice = '') {
    const draft = getDraft(interaction);
    if (section === 'welcome') return welcomePayload(draft, notice);
    if (section === 'logging') return loggingPayload(draft, notice);
    if (section === 'tickets') return ticketPayload(draft, notice);
    if (section === 'voice') return voicePayload(draft, notice);
    if (section === 'leveling') return levelingPayload(draft, notice);
    return mainPayload(draft, notice);
}

function applySetupDraftToConfig(config, section, draft) {
    if (section === 'welcome') {
        config.WelcomeEmbed ||= {};
        config.welcomeID = draft.welcome.enabled ? draft.welcome.channelId : '';
        config.WelcomeEmbed.title = draft.welcome.title;
        config.WelcomeEmbed.description = draft.welcome.description;
        return 'Welcome settings saved.';
    }

    if (section === 'logging') {
        config.logChannels = { ...(config.logChannels || {}), ...draft.logging.channels };
        return 'Logging settings saved.';
    }

    if (section === 'tickets') {
        config.tickets ||= {};
        config.tickets.channelId = draft.tickets.channelId;
        config.tickets.categoryId = draft.tickets.categoryId;
        config.tickets.supportRoleId = draft.tickets.supportRoleId;
        config.tickets.allowTranscripts = draft.tickets.allowTranscripts;
        config.tickets.allowUserAdding = draft.tickets.allowUserAdding;
        config.tickets.allowClaiming = draft.tickets.allowClaiming;
        return 'Ticket settings saved.';
    }

    if (section === 'voice') {
        config.joinToCreate ||= {};
        config.joinToCreate.enabled = draft.voice.enabled;
        config.joinToCreate.triggerChannelId = draft.voice.triggerChannelId;
        config.joinToCreate.categoryId = draft.voice.categoryId;
        config.joinToCreate.nameFormat = draft.voice.nameFormat;
        config.joinToCreate.userLimitMax = draft.voice.userLimitMax;
        return 'Temporary voice settings saved.';
    }

    if (section === 'leveling') {
        config.leveling ||= {};
        config.leveling.enabled = draft.leveling.enabled;
        config.leveling.mode = draft.leveling.mode;
        config.leveling.textXpPerMessage ??= 1;
        config.leveling.voiceXpPerMinute ??= 1;
        config.leveling.cooldownSeconds ??= 60;
        config.leveling.roleRewards ||= [];
        return 'Leveling settings saved.';
    }

    return 'Nothing saved.';
}

function canUseSetup(interaction) {
    if (!interaction.memberPermissions?.has) return true;
    return interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

async function denySetup(interaction) {
    await interaction.reply({
        content: 'You need Manage Server permission to use setup controls.',
        flags: MessageFlags.Ephemeral,
    });
}

async function updateSetupMessage(interaction, payload) {
    if (interaction.update) {
        const { flags, ...updatePayload } = payload;
        void flags;
        return interaction.update(updatePayload);
    }
    return interaction.reply(payload);
}

function getSelectedValue(interaction) {
    return interaction.values?.[0] || '';
}

async function handleSetupButton(interaction) {
    if (!interaction.isButton?.() || !interaction.customId?.startsWith(setupPrefix)) return false;
    if (!canUseSetup(interaction)) {
        await denySetup(interaction);
        return true;
    }

    const [, action, section] = interaction.customId.split(':');
    const draft = getDraft(interaction);

    if (action === 'open') {
        await updateSetupMessage(interaction, createSetupPayload(interaction, section));
        return true;
    }

    if (action === 'back') {
        await updateSetupMessage(interaction, createSetupPayload(interaction, 'main'));
        return true;
    }

    if (action === 'modal' && section === 'welcome-message') {
        await interaction.showModal(modal('setup:modal-submit:welcome-message', 'Welcome Message', [
            textInput('title', 'Embed title', { value: draft.welcome.title, maxLength: 256 }),
            textInput('description', 'Message', { style: TextInputStyle.Paragraph, value: draft.welcome.description, maxLength: 4000 }),
        ]));
        return true;
    }

    if (action === 'modal' && section === 'voice-options') {
        await interaction.showModal(modal('setup:modal-submit:voice-options', 'Temporary Voice Options', [
            textInput('nameFormat', 'Name format', { value: draft.voice.nameFormat, maxLength: 100 }),
            textInput('userLimitMax', 'Maximum users', { value: `${draft.voice.userLimitMax}`, maxLength: 2 }),
        ]));
        return true;
    }

    if (action === 'save') {
        let message = '';
        updateConfig(config => {
            message = applySetupDraftToConfig(config, section, draft);
            return config;
        });
        await updateSetupMessage(interaction, createSetupPayload(interaction, section, message));
        return true;
    }

    return false;
}

async function handleSetupStringSelect(interaction) {
    if (!interaction.isStringSelectMenu?.() || !interaction.customId?.startsWith('setup:string:')) return false;
    if (!canUseSetup(interaction)) {
        await denySetup(interaction);
        return true;
    }

    const draft = getDraft(interaction);
    const key = interaction.customId.split(':')[2];
    const value = getSelectedValue(interaction);

    if (key === 'welcome-enabled') draft.welcome.enabled = value === 'enabled';
    if (key === 'logging-category') draft.logging.activeCategory = value;
    if (key === 'tickets-controls') {
        const selected = new Set(interaction.values || []);
        draft.tickets.allowTranscripts = selected.has('allowTranscripts');
        draft.tickets.allowUserAdding = selected.has('allowUserAdding');
        draft.tickets.allowClaiming = selected.has('allowClaiming');
    }
    if (key === 'voice-enabled') draft.voice.enabled = value === 'enabled';
    if (key === 'leveling-enabled') draft.leveling.enabled = value === 'enabled';
    if (key === 'leveling-mode') draft.leveling.mode = value;

    await updateSetupMessage(interaction, createSetupPayload(interaction, draft.section, 'Draft updated.'));
    return true;
}

async function handleSetupChannelSelect(interaction) {
    if (!interaction.isChannelSelectMenu?.() || !interaction.customId?.startsWith('setup:channel:')) return false;
    if (!canUseSetup(interaction)) {
        await denySetup(interaction);
        return true;
    }

    const draft = getDraft(interaction);
    const key = interaction.customId.split(':')[2];
    const value = getSelectedValue(interaction);

    if (key === 'welcome') draft.welcome.channelId = value;
    if (key === 'logging') draft.logging.channels[draft.logging.activeCategory] = value;
    if (key === 'tickets-panel') draft.tickets.channelId = value;
    if (key === 'tickets-category') draft.tickets.categoryId = value;
    if (key === 'voice-trigger') draft.voice.triggerChannelId = value;
    if (key === 'voice-category') draft.voice.categoryId = value;

    await updateSetupMessage(interaction, createSetupPayload(interaction, draft.section, 'Draft updated.'));
    return true;
}

async function handleSetupRoleSelect(interaction) {
    if (!interaction.isRoleSelectMenu?.() || interaction.customId !== 'setup:role:tickets-support') return false;
    if (!canUseSetup(interaction)) {
        await denySetup(interaction);
        return true;
    }

    const draft = getDraft(interaction);
    draft.tickets.supportRoleId = getSelectedValue(interaction);
    await updateSetupMessage(interaction, createSetupPayload(interaction, 'tickets', 'Draft updated.'));
    return true;
}

async function handleSetupModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.customId?.startsWith('setup:modal-submit:')) return false;
    if (!canUseSetup(interaction)) {
        await denySetup(interaction);
        return true;
    }

    const draft = getDraft(interaction);
    const key = interaction.customId.split(':')[2];

    if (key === 'welcome-message') {
        draft.welcome.title = interaction.fields.getTextInputValue('title').trim();
        draft.welcome.description = interaction.fields.getTextInputValue('description').trim();
        await updateSetupMessage(interaction, createSetupPayload(interaction, 'welcome', 'Draft updated.'));
        return true;
    }

    if (key === 'voice-options') {
        const limit = Number(interaction.fields.getTextInputValue('userLimitMax'));
        draft.voice.nameFormat = interaction.fields.getTextInputValue('nameFormat').trim() || "{username}'s Channel";
        draft.voice.userLimitMax = Number.isInteger(limit) && limit >= 1 && limit <= 99 ? limit : 25;
        await updateSetupMessage(interaction, createSetupPayload(interaction, 'voice', 'Draft updated.'));
        return true;
    }

    return false;
}

module.exports = {
    applySetupDraftToConfig,
    createDraft,
    createSetupPayload,
    handleSetupButton,
    handleSetupChannelSelect,
    handleSetupModal,
    handleSetupRoleSelect,
    handleSetupStringSelect,
    resetSetupDrafts,
};
