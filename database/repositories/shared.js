function now() {
    return Date.now();
}

function stringify(value, fallback) {
    return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function pruneTableByNewest(db, table, maxEntries) {
    const limit = Number(maxEntries);
    if (!Number.isInteger(limit) || limit <= 0) return 0;
    return db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY created_at DESC LIMIT ?)`).run(limit).changes;
}

module.exports = {
    now,
    parseJson,
    pruneTableByNewest,
    stringify,
};
