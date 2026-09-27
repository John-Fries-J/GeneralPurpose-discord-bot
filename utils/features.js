const { getConfig } = require('./config');

function isModuleEnabled(moduleName, config = getConfig()) {
    return config.commandSettings?.modules?.[moduleName] !== false;
}

function isCommandEnabled(command, config = getConfig()) {
    const name = typeof command === 'string' ? command : command?.data?.name;
    const category = typeof command === 'string' ? null : command?.category;

    if (category && !isModuleEnabled(category, config)) return false;
    return config.commandSettings?.commands?.[name] !== false;
}

function getCommandSettings(config = getConfig()) {
    return {
        access: config.commandSettings?.access || {},
        modules: config.commandSettings?.modules || {},
        commands: config.commandSettings?.commands || {},
    };
}

module.exports = {
    getCommandSettings,
    isCommandEnabled,
    isModuleEnabled,
};
