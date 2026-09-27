const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', '.idea', '.vscode', 'node_modules']);

function collectJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (ignoredDirectories.has(entry.name)) return [];
            return collectJavaScriptFiles(fullPath);
        }

        return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
    });
}

let failed = false;

for (const file of collectJavaScriptFiles(root)) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
