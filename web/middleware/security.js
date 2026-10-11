function securityHeaders(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.path.startsWith('/activity') || req.path.startsWith('/api/activity')) {
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "connect-src 'self' https://discord.com https://*.discord.com",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
        ].join('; '));
    } else {
        res.setHeader('X-Frame-Options', 'DENY');
    }

    next();
}

module.exports = {
    securityHeaders,
};
