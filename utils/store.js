const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('./config');

const defaultDataPath = path.join(__dirname, '..', 'data', 'bot-state.json');

function resolveDataPath(config = getConfig()) {
    return path.resolve(__dirname, '..', config.database?.jsonPath || 'data/bot-state.json');
}

function createEmptyState() {
    return {
        tempBans: [],
        tempMutes: [],
    };
}

function readState() {
    const config = getConfig();
    const provider = config.database?.provider || 'json';

    if (provider !== 'json') {
        console.warn(`[DATABASE] Provider "${provider}" is configured but this build only includes the JSON adapter. Falling back to JSON storage.`);
    }

    const filePath = provider === 'json' ? resolveDataPath(config) : defaultDataPath;
    if (!fs.existsSync(filePath)) return createEmptyState();

    return {
        ...createEmptyState(),
        ...JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
}

function writeState(state) {
    const config = getConfig();
    const provider = config.database?.provider || 'json';
    const filePath = provider === 'json' ? resolveDataPath(config) : defaultDataPath;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ ...createEmptyState(), ...state }, null, 4)}\n`);
}

function updateState(updater) {
    const state = readState();
    const nextState = updater(state) || state;
    writeState(nextState);
    return nextState;
}

function upsertTempBan(record) {
    updateState(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempBans.push(record);
        return state;
    });
}

function removeTempBan(guildId, userId) {
    updateState(state => {
        state.tempBans = state.tempBans.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

function upsertTempMute(record) {
    updateState(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === record.guildId && item.userId === record.userId));
        state.tempMutes.push(record);
        return state;
    });
}

function removeTempMute(guildId, userId) {
    updateState(state => {
        state.tempMutes = state.tempMutes.filter(item => !(item.guildId === guildId && item.userId === userId));
        return state;
    });
}

function getTempMute(guildId, userId) {
    return readState().tempMutes.find(item => item.guildId === guildId && item.userId === userId) || null;
}

module.exports = {
    getTempMute,
    readState,
    removeTempBan,
    removeTempMute,
    upsertTempBan,
    upsertTempMute,
};
