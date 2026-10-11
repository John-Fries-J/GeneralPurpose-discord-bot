const buckets = new Map();

const defaultLimits = Object.freeze({
    voiceRename: { limit: 4, windowMs: 60_000 },
    voiceLimit: { limit: 10, windowMs: 60_000 },
    voiceLock: { limit: 16, windowMs: 60_000 },
    voiceMember: { limit: 12, windowMs: 60_000 },
    voiceDelete: { limit: 3, windowMs: 60_000 },
    musicSearch: { limit: 6, windowMs: 60_000 },
    musicControl: { limit: 18, windowMs: 60_000 },
    musicVolume: { limit: 20, windowMs: 60_000 },
    musicQueue: { limit: 16, windowMs: 60_000 },
});

function cleanupBuckets(now = Date.now()) {
    for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}

function consumeRateLimit({ key, limit, windowMs }) {
    cleanupBuckets();
    const now = Date.now();
    const bucketKey = String(key);
    const current = buckets.get(bucketKey);

    if (!current || current.resetAt <= now) {
        buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
    }

    if (current.count >= limit) {
        return { ok: false, remaining: 0, retryAfterMs: Math.max(0, current.resetAt - now) };
    }

    current.count += 1;
    return { ok: true, remaining: Math.max(0, limit - current.count), retryAfterMs: 0 };
}

function activityRateLimiter(action, options = {}) {
    const definition = {
        ...(defaultLimits[action] || { limit: 20, windowMs: 60_000 }),
        ...options,
    };

    return (req, res, next) => {
        const userId = req.activitySession?.user?.id || 'anonymous';
        const guildId = req.activityContext?.guildId || req.body?.guildId || req.query.guildId || 'global';
        const result = consumeRateLimit({
            key: `activity:${action}:${guildId}:${userId}`,
            limit: definition.limit,
            windowMs: definition.windowMs,
        });

        res.setHeader('X-RateLimit-Limit', String(definition.limit));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        if (!result.ok) {
            res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
            return res.status(429).json({
                ok: false,
                error: {
                    code: 'rate_limited',
                    message: 'You are doing that too quickly. Try again in a moment.',
                    retryAfterMs: result.retryAfterMs,
                },
            });
        }

        return next();
    };
}

module.exports = {
    activityRateLimiter,
    consumeRateLimit,
    defaultLimits,
    __testing: {
        buckets,
        cleanupBuckets,
    },
};
