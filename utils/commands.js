const fs = require('node:fs');
const path = require('node:path');

function getCommandFiles() {
    const foldersPath = path.join(__dirname, '..', 'commands');
    const commandFolders = fs.readdirSync(foldersPath)
        .filter(folder => fs.statSync(path.join(foldersPath, folder)).isDirectory());

    return commandFolders.flatMap(folder => {
        const commandsPath = path.join(foldersPath, folder);
        return fs.readdirSync(commandsPath)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(commandsPath, file));
    });
}

function loadCommands() {
    return getCommandFiles()
        .map(filePath => {
            const command = require(filePath);
            if (command && !command.category) {
                command.category = path.basename(path.dirname(filePath));
            }

            return { filePath, command };
        })
        .filter(({ filePath, command }) => {
            const isValid = command?.data && typeof command.execute === 'function';
            if (!isValid) {
                console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }

            return isValid;
        });
}

module.exports = {
    getCommandFiles,
    loadCommands,
};
