function isUserContextCommand(interaction) {
    return interaction.isUserContextMenuCommand?.() === true;
}

function isMessageContextCommand(interaction) {
    return interaction.isMessageContextMenuCommand?.() === true;
}

function isContextCommand(interaction) {
    return isUserContextCommand(interaction) || isMessageContextCommand(interaction);
}

async function routeContextCommand(interaction, runCommand) {
    if (!isContextCommand(interaction)) return false;
    return runCommand(interaction);
}

module.exports = {
    isContextCommand,
    isMessageContextCommand,
    isUserContextCommand,
    routeContextCommand,
};
