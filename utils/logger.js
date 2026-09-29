const levelWeights = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const {
    isSensitiveKey,
    redactText,
    redactedValue,
} = require('./redaction');

function getConfiguredLevel() {
    const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
    return levelWeights[configured] ? configured : 'info';
}

function serializeError(error) {
    return {
        name: error.name || 'Error',
        message: redactText(error.message || String(error)),
        stack: redactText(error.stack),
    };
}

function redact(value, depth = 0, seen = new WeakSet(), keyPath = []) {
    if (value instanceof Error) return serializeError(value);
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return redactText(value);
    if (typeof value !== 'object') return value;
    if (depth > 6) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => redact(item, depth + 1, seen, keyPath));
    }

    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key, keyPath) ? redactedValue : redact(item, depth + 1, seen, [...keyPath, key]),
    ]));
}

function normalizeContext(context) {
    if (!context) return {};
    if (context instanceof Error) return { error: serializeError(context) };
    if (typeof context !== 'object') return { value: context };
    return redact(context);
}

function createLogger(defaultContext = {}, options = {}) {
    const threshold = levelWeights[options.level || getConfiguredLevel()] || levelWeights.info;
    const sink = options.sink || console;

    function write(level, message, context) {
        if (levelWeights[level] < threshold) return;
        const payload = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...redact(defaultContext),
            ...normalizeContext(context),
        };
        const line = JSON.stringify(payload);
        const method = level === 'debug' ? 'debug' : (level === 'info' ? 'log' : level);
        (sink[method] || sink.log || console.log).call(sink, line);
    }

    return {
        child(context = {}) {
            return createLogger({ ...defaultContext, ...context }, { ...options, sink, level: options.level || getConfiguredLevel() });
        },
        debug(message, context) {
            write('debug', message, context);
        },
        info(message, context) {
            write('info', message, context);
        },
        warn(message, context) {
            write('warn', message, context);
        },
        error(message, context) {
            write('error', message, context);
        },
    };
}

const logger = createLogger();

module.exports = {
    createLogger,
    logger,
    redact,
    serializeError,
};
