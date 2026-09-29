const redactedValue = '[redacted]';
const dangerousConfigKeys = new Set(['__proto__', 'constructor', 'prototype']);

function splitKeyWords(key) {
    return String(key ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function compactKey(key) {
    return splitKeyWords(key).join('');
}

function pathSegments(pathParts = []) {
    return pathParts.map(compactKey).filter(Boolean);
}

function hasAny(value, candidates) {
    return candidates.some(candidate => value.includes(candidate));
}

function isDatabaseContext(segments) {
    return segments.some(segment => [
        'database',
        'db',
        'mysql',
        'mariadb',
        'postgres',
        'postgresql',
        'mongo',
        'mongodb',
        'redis',
        'connection',
        'connections',
    ].includes(segment));
}

function isSensitiveKey(key, pathParts = []) {
    const words = splitKeyWords(key);
    const compact = words.join('');
    if (!compact) return false;

    if (words.includes('token') || words.includes('secret') || words.includes('password')) return true;
    if (compact.includes('token') || compact.includes('secret') || compact.includes('password')) return true;
    if (words.includes('credential') || words.includes('credentials') || compact.includes('credential')) return true;
    if (words.includes('authorization')) return true;
    if ((words.includes('cookie') || words.includes('cookies')) && !words.includes('path')) return true;
    if (compact.includes('apikey') || compact.includes('clientsecret') || compact.includes('sessionsecret') || compact.includes('cookiesecret')) return true;
    if (compact.includes('connectionstring')) return true;
    if (hasAny(compact, ['databaseurl', 'dburl', 'connectionurl', 'mysqlurl', 'mariadburl', 'postgresurl', 'postgresqlurl', 'mongourl', 'mongodburl', 'redisurl'])) return true;

    const segments = pathSegments([...pathParts, key]);
    const isUrlField = words.includes('url') || words.includes('uri') || compact.endsWith('url') || compact.endsWith('uri');
    return isUrlField && isDatabaseContext(segments);
}

function isProtectedDeploymentKey(key, pathParts = []) {
    if (isSensitiveKey(key, pathParts)) return true;

    const fullPath = pathSegments([...pathParts, key]).join('.');
    return [
        'database.provider',
        'database.jsonpath',
        'database.sqlitepath',
    ].includes(fullPath);
}

function isDangerousConfigKey(key) {
    return dangerousConfigKeys.has(String(key));
}

function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function isEmptySensitiveValue(value) {
    return value === '' || value === null || value === undefined;
}

function redactText(value, replacement = redactedValue) {
    if (typeof value !== 'string' || value === '') return value;

    const secretKey = [
        'token',
        'bot[-_\\s]?token',
        'secret',
        'password',
        'api[-_\\s]?key',
        'client[-_\\s]?secret',
        'session[-_\\s]?secret',
        'cookie[-_\\s]?secret',
        'credential',
        'database[-_\\s]?url',
        'connection[-_\\s]?(?:url|string)',
        'mysql[-_\\s]?url',
        'mariadb[-_\\s]?url',
        'postgres(?:ql)?[-_\\s]?url',
        'mongo(?:db)?[-_\\s]?url',
        'redis[-_\\s]?url',
    ].join('|');

    return value
        .replace(new RegExp(`\\b(${secretKey})(\\s*[:=]\\s*)(["']?)([^"',\\s}<]+)`, 'gi'), `$1$2$3${replacement}`)
        .replace(/\b(Bot|Bearer)\s+[A-Za-z0-9._-]{8,}/gi, `$1 ${replacement}`)
        .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, replacement);
}

function redactSensitiveConfig(value, key = '', pathParts = [], options = {}) {
    const replacement = options.replacement || redactedValue;
    const currentPath = key === '' ? pathParts : [...pathParts, key];

    if (key !== '' && isSensitiveKey(key, pathParts) && !isEmptySensitiveValue(value)) {
        return replacement;
    }

    if (Array.isArray(value)) {
        return value.map(item => redactSensitiveConfig(item, '', currentPath, options));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            redactSensitiveConfig(childValue, childKey, currentPath, options),
        ]));
    }

    return typeof value === 'string' ? redactText(value, replacement) : value;
}

function restoreProtectedConfig(submitted, current, key = '', pathParts = []) {
    const currentPath = key === '' ? pathParts : [...pathParts, key];
    if (key !== '' && isProtectedDeploymentKey(key, pathParts)) {
        if (current !== undefined) return clone(current);
        if (submitted === redactedValue || isSensitiveKey(key, pathParts)) return '';
        return clone(submitted);
    }

    if (Array.isArray(submitted)) {
        return submitted.map((item, index) => restoreProtectedConfig(item, current?.[index], '', currentPath));
    }

    if (submitted && typeof submitted === 'object') {
        return Object.fromEntries(Object.entries(submitted).map(([childKey, childValue]) => [
            childKey,
            restoreProtectedConfig(childValue, current?.[childKey], childKey, currentPath),
        ]));
    }

    if (submitted === redactedValue) {
        return current ?? '';
    }

    return submitted;
}

function assertSafeConfigObject(value, pathParts = []) {
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
        if (isDangerousConfigKey(key)) {
            throw new Error(`Dangerous configuration key rejected: ${[...pathParts, key].join('.')}`);
        }
        assertSafeConfigObject(child, [...pathParts, key]);
    }
}

function safeErrorMessage(error, fallback = 'Operation failed.') {
    const raw = error instanceof Error ? error.message : String(error || fallback);
    const redacted = redactText(raw || fallback);
    return redacted || fallback;
}

module.exports = {
    assertSafeConfigObject,
    dangerousConfigKeys,
    isDangerousConfigKey,
    isProtectedDeploymentKey,
    isSensitiveKey,
    redactSensitiveConfig,
    redactText,
    redactedValue,
    restoreProtectedConfig,
    safeErrorMessage,
};
