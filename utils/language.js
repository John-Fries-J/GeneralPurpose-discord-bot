const fs = require('node:fs');
const path = require('node:path');

const languagePath = path.join(__dirname, '..', 'language.json');

function loadLanguage() {
    try {
        return JSON.parse(fs.readFileSync(languagePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not load language.json: ${error.message}`);
    }
}

module.exports = loadLanguage();
