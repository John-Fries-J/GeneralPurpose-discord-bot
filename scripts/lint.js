const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', '.idea', '.vscode', 'data', 'node_modules']);
const ignoredFiles = new Set(['config.json']);
const checkedExtensions = new Set(['.js', '.json', '.md', '.yml', '.yaml']);

function collectFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (ignoredDirectories.has(entry.name)) return [];
            return collectFiles(fullPath);
        }

        if (entry.isFile() && !ignoredFiles.has(entry.name) && checkedExtensions.has(path.extname(entry.name))) {
            return [fullPath];
        }

        return [];
    });
}

function relative(filePath) {
    return path.relative(root, filePath);
}

const failures = [];

for (const filePath of collectFiles(root)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
        if (line.includes('\t')) {
            failures.push(`${relative(filePath)}:${index + 1} contains a tab character.`);
        }
        if (/\s+$/.test(line)) {
            failures.push(`${relative(filePath)}:${index + 1} has trailing whitespace.`);
        }
    });

    if (!content.endsWith('\n')) {
        failures.push(`${relative(filePath)} must end with a newline.`);
    }

    if (path.extname(filePath) === '.json') {
        try {
            JSON.parse(content);
        } catch (error) {
            failures.push(`${relative(filePath)} is invalid JSON: ${error.message}`);
        }
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
