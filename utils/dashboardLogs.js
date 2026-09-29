const fs = require('node:fs');
const path = require('node:path');
const { redactSensitiveConfig, redactText } = require('./redaction');

const dataDirectory = path.join(__dirname, '..', 'data');
const logPath = path.join(dataDirectory, 'dashboard.log');

function getDashboardLogPath(options = {}) {
    return options.logPath || logPath;
}

function ensureLogDirectory(targetPath = logPath) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function appendDashboardLog(message, meta = {}, options = {}) {
    const targetPath = getDashboardLogPath(options);
    ensureLogDirectory(targetPath);

    const line = JSON.stringify({
        at: new Date().toISOString(),
        message: redactText(String(message || '')),
        ...redactSensitiveConfig(meta),
    });

    fs.appendFileSync(targetPath, `${line}\n`);
}

function readDashboardLogs(limit = 100, options = {}) {
    const targetPath = getDashboardLogPath(options);
    if (!fs.existsSync(targetPath)) return [];

    return fs.readFileSync(targetPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .map(line => {
            try {
                return redactSensitiveConfig(JSON.parse(line));
            } catch {
                return { at: '', message: redactText(line) };
            }
        })
        .reverse();
}

function clearDashboardLogs(options = {}) {
    const targetPath = getDashboardLogPath(options);
    ensureLogDirectory(targetPath);
    fs.writeFileSync(targetPath, '');
}

module.exports = {
    appendDashboardLog,
    clearDashboardLogs,
    getDashboardLogPath,
    readDashboardLogs,
};
