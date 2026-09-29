const { MessageFlags } = require('discord.js');
const language = require('./language');
const { createEmbed } = require('./embeds');
const { row, stringSelect } = require('./discordComponents');
const { isCommandEnabled } = require('./features');
const { memberCanUseCommand } = require('./permissions');

const helpCategoryCustomId = 'help:category';

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
    if (!options.length) return [];
    return [row(stringSelect(helpCategoryCustomId, 'Choose a command category', options))];
}

function createMainHelpPayload(interaction) {
    const categories = groupVisibleCommands(interaction);
    const fields = categories.map(([category, commands]) => ({
        name: category,
        value: commands.slice(0, 8).map(command => `/${command.data.name}`).join(', ') || 'No commands',
        inline: true,
    }));

    return {
        embeds: [createEmbed({
            title: language.help.title || 'GeneralPurpose',
            description: 'Choose a category to browse available commands.',
            fields,
            color: 'blue',
        })],
        components: helpSelector(categories),
        flags: MessageFlags.Ephemeral,
    };
}

function createCategoryHelpPayload(interaction, selectedCategory) {
    const categories = groupVisibleCommands(interaction);
    const category = categories.find(([name]) => name === selectedCategory) || categories[0];
    if (!category) return createMainHelpPayload(interaction);

    const [name, commands] = category;
    const fields = commands.slice(0, 20).map(command => ({
        name: `/${command.data.name}`,
        value: command.data.description || 'No description',
    }));

    return {
        embeds: [createEmbed({
            title: `${name} Commands`,
            description: 'Use `/help command:<name>` for command details.',
            fields,
            color: 'blue',
        })],
        components: helpSelector(categories, name),
        flags: MessageFlags.Ephemeral,
    };
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

function createCommandHelpPayload(interaction, commandName) {
    const command = interaction.client.commands.get(commandName);
    if (!command || !isCommandEnabled(command) || !memberCanUseCommand(interaction, command)) {
        return {
            content: language.help.missingCommand,
            flags: MessageFlags.Ephemeral,
        };
    }

    const json = command.data.toJSON?.() || command.data;
    const options = (json.options || [])
        .filter(option => option.type !== 1 && option.type !== 2)
        .map(option => `**${option.name}:** ${option.description || 'No description'}${option.required ? ' (required)' : ''}`);

    return {
        embeds: [createEmbed({
            title: `/${json.name}`,
            description: json.description || command.data.description || 'No description',
            fields: [
                { name: 'Usage', value: commandUsage(command) },
                { name: 'Module', value: getCommandCategory(command), inline: true },
                { name: 'Permissions', value: json.default_member_permissions ? 'Restricted' : 'Everyone', inline: true },
                options.length ? { name: 'Options', value: options.join('\n').slice(0, 1024) } : null,
            ].filter(Boolean),
            color: 'blue',
        })],
        components: helpSelector(groupVisibleCommands(interaction), getCommandCategory(command)),
        flags: MessageFlags.Ephemeral,
    };
}

async function handleHelpStringSelect(interaction) {
    if (!interaction.isStringSelectMenu?.() || interaction.customId !== helpCategoryCustomId) return false;
    const { flags, ...payload } = createCategoryHelpPayload(interaction, interaction.values?.[0]);
    void flags;
    await interaction.update(payload);
    return true;
}

module.exports = {
    createCategoryHelpPayload,
    createCommandHelpPayload,
    createMainHelpPayload,
    getVisibleCommands,
    groupVisibleCommands,
    handleHelpStringSelect,
    helpCategoryCustomId,
};
