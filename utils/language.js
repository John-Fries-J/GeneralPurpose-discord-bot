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

function saveLanguage(language) {
    if (!language || typeof language !== 'object' || Array.isArray(language)) {
        throw new Error('language.json must be a JSON object.');
    }

    fs.writeFileSync(languagePath, `${JSON.stringify(language, null, 4)}\n`);
    return language;
}

const api = {
    languagePath,
    loadLanguage,
    saveLanguage,
};

module.exports = new Proxy(api, {
    get(target, property) {
        if (property in target) return target[property];
        return loadLanguage()[property];
    },
    ownKeys() {
        return Reflect.ownKeys(loadLanguage());
    },
    getOwnPropertyDescriptor(target, property) {
        if (property in target) {
            return Object.getOwnPropertyDescriptor(target, property);
        }

        return {
            enumerable: true,
            configurable: true,
        };
    },
});
