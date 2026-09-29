const { ButtonStyle, MessageFlags } = require('discord.js');
const language = require('./language');
const {
    actionRow,
    button,
    container,
    section,
    separator,
    stringSelect,
    textDisplay,
    v2Payload,
    v2UpdatePayload,
} = require('./discordUi');
const { isCommandEnabled } = require('./features');
const { memberCanUseCommand } = require('./permissions');

const helpCategoryCustomId = 'help:category';
const helpHomeCustomId = 'help:home';
const helpCategoryButtonPrefix = 'help:category-button:';

const categoryDescriptions = {
    config: 'Server setup, integrations, counters, and admin configuration.',
    Context: 'Right-click actions for moderation and user lookup workflows.',
    context: 'Right-click actions for moderation and user lookup workflows.',
    moderation: 'Case management, notes, warnings, roles, mutes, bans, and channel controls.',
    suggestions: 'Suggestion submission and staff review tools.',
    ticket: 'Ticket panel, close, delete, and transcript controls.',
    Utility: 'Everyday server, profile, music, reminder, and information commands.',
    utility: 'Everyday server, profile, music, reminder, and information commands.',
};

function getCommandCategory(command) {
    return command.category || 'General';
}

function getVisibleCommands(interaction) {
    return [...interaction.client.commands.values()]
        .filter(command => isCommandEnabled(command))
        .filter(command => memberCanUseCommand(interaction, command))
        .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

function groupVisibleCommands(interaction) {
    const categories = new Map();
    for (const command of getVisibleCommands(interaction)) {
        const category = getCommandCategory(command);
        const current = categories.get(category) || [];
        current.push(command);
        categories.set(category, current);
    }

    return [...categories.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function encodeCategory(category) {
    return encodeURIComponent(category).slice(0, 70);
}

function decodeCategory(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function categoryOptions(categories, selected = '') {
    return categories.slice(0, 25).map(([category, commands]) => ({
        label: category,
        value: category,
        description: `${commands.length} command${commands.length === 1 ? '' : 's'}`,
        default: category === selected,
    }));
}

function helpSelector(categories, selected = '') {
    const options = categoryOptions(categories, selected);
    if (!options.length) return null;
    return actionRow(stringSelect(helpCategoryCustomId, 'Browse command modules', options));
}

function commandNames(commands, limit = 7) {
    const names = commands.slice(0, limit).map(command => `/${command.data.name}`);
    const remaining = commands.length - names.length;
    return `${names.join(', ')}${remaining > 0 ? `, +${remaining} more` : ''}`;
}

function moduleDescription(category) {
    return categoryDescriptions[category] || 'Commands in this module.';
}

function moduleSection(category, commands) {
    return section(
        `### ${category}\n${moduleDescription(category)}\n${commands.length} command${commands.length === 1 ? '' : 's'}: ${commandNames(commands)}`,
        button(`${helpCategoryButtonPrefix}${encodeCategory(category)}`, 'Open', ButtonStyle.Secondary),
    );
}

function controls(categories, selected = '', { includeBack = false } = {}) {
    const rows = [];
    const selector = helpSelector(categories, selected);
    if (selector) rows.push(selector);
    if (includeBack) rows.push(actionRow(button(helpHomeCustomId, 'Back', ButtonStyle.Secondary)));
    return rows;
}

function createHelpContainer(interaction, bodyComponents) {
    const title = language.help.title && language.help.title !== 'Help'
        ? language.help.title
        : 'GeneralPurpose Help';
    const guildName = interaction.guild?.name ? ` for ${interaction.guild.name}` : '';

    return container([
        textDisplay(`## ${title}${guildName}\nBrowse commands by module. Only commands available to you are shown.`),
        separator(),
        ...bodyComponents,
    ]);
}

function createMainHelpPayload(interaction) {
    const categories = groupVisibleCommands(interaction);
    const body = categories.length
        ? categories.map(([category, commands]) => moduleSection(category, commands))
        : [textDisplay('No commands are currently available to you.')];

    return v2Payload(createHelpContainer(interaction, [
        ...body,
        ...controls(categories),
    ]));
}

function createCategoryHelpPayload(interaction, selectedCategory) {
    const categories = groupVisibleCommands(interaction);
    const category = categories.find(([name]) => name === selectedCategory) || categories[0];
    if (!category) return createMainHelpPayload(interaction);

    const [name, commands] = category;
    const commandLines = commands.slice(0, 20)
        .map(command => `**/${command.data.name}** - ${command.data.description || 'No description'}`);

    return v2Payload(createHelpContainer(interaction, [
        textDisplay(`### ${name}\n${moduleDescription(name)}\n${commands.length} command${commands.length === 1 ? '' : 's'} available.`),
        separator(),
        textDisplay(commandLines.join('\n') || 'No commands in this module.'),
        textDisplay('Use `/help command:<name>` to open a detailed command view.'),
        ...controls(categories, name, { includeBack: true }),
    ]));
}

function commandUsage(command) {
    const json = command.data.toJSON?.() || command.data;
    const options = json.options || [];
    const optionText = options
        .filter(option => option.type !== 1 && option.type !== 2)
        .map(option => option.required ? `<${option.name}>` : `[${option.name}]`)
        .join(' ');

    return `/${json.name}${optionText ? ` ${optionText}` : ''}`;
}

function permissionLabel(json) {
    return json.default_member_permissions ? 'Restricted by Discord permissions' : 'Available to everyone with command access';
}

function createCommandHelpPayload(interaction, commandName) {
    const command = interaction.client.commands.get(commandName);
    if (!command || !isCommandEnabled(command) || !memberCanUseCommand(interaction, command)) {
        return {
            components: [container([
                textDisplay(`## Command Not Available\n${language.help.missingCommand}`),
                actionRow(button(helpHomeCustomId, 'Back', ButtonStyle.Secondary)),
            ])],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        };
    }

    const json = command.data.toJSON?.() || command.data;
    const options = (json.options || [])
        .filter(option => option.type !== 1 && option.type !== 2)
        .map(option => `**${option.name}** - ${option.description || 'No description'}${option.required ? ' _(required)_' : ''}`);
    const categories = groupVisibleCommands(interaction);

    return v2Payload(createHelpContainer(interaction, [
        textDisplay(`### /${json.name}\n${json.description || command.data.description || 'No description'}`),
        separator(),
        textDisplay(`**Usage**\n\`${commandUsage(command)}\`\n\n**Module**\n${getCommandCategory(command)}\n\n**Permissions**\n${permissionLabel(json)}`),
        options.length ? textDisplay(`**Options**\n${options.join('\n').slice(0, 1900)}`) : textDisplay('**Options**\nThis command has no options.'),
        ...controls(categories, getCommandCategory(command), { includeBack: true }),
    ]));
}

async function handleHelpStringSelect(interaction) {
    if (!interaction.isStringSelectMenu?.() || interaction.customId !== helpCategoryCustomId) return false;
    const payload = createCategoryHelpPayload(interaction, interaction.values?.[0]);
    await interaction.update(v2UpdatePayload(payload.components));
    return true;
}

async function handleHelpButton(interaction) {
    if (!interaction.isButton?.()) return false;

    if (interaction.customId === helpHomeCustomId) {
        const payload = createMainHelpPayload(interaction);
        await interaction.update(v2UpdatePayload(payload.components));
        return true;
    }

    if (interaction.customId?.startsWith(helpCategoryButtonPrefix)) {
        const category = decodeCategory(interaction.customId.slice(helpCategoryButtonPrefix.length));
        const payload = createCategoryHelpPayload(interaction, category);
        await interaction.update(v2UpdatePayload(payload.components));
        return true;
    }

    return false;
}

module.exports = {
    createCategoryHelpPayload,
    createCommandHelpPayload,
    createMainHelpPayload,
    getVisibleCommands,
    groupVisibleCommands,
    handleHelpButton,
    handleHelpStringSelect,
    helpCategoryButtonPrefix,
    helpCategoryCustomId,
    helpHomeCustomId,
};
