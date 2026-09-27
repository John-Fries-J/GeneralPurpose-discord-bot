const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(__dirname, '..', 'data');
const logPath = path.join(dataDirectory, 'dashboard.log');

function ensureDataDirectory() {
    fs.mkdirSync(dataDirectory, { recursive: true });
}

function appendDashboardLog(message, meta = {}) {
    ensureDataDirectory();

    const line = JSON.stringify({
        at: new Date().toISOString(),
        message,
        ...meta,
    });

    fs.appendFileSync(logPath, `${line}\n`);
}

function readDashboardLogs(limit = 100) {
    if (!fs.existsSync(logPath)) return [];

    return fs.readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return { at: '', message: line };
            }
        })
        .reverse();
}

function clearDashboardLogs() {
    ensureDataDirectory();
    fs.writeFileSync(logPath, '');
}

module.exports = {
    appendDashboardLog,
    clearDashboardLogs,
    readDashboardLogs,
};
