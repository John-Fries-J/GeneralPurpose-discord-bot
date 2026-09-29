function securityHeaders(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
}

module.exports = {
    securityHeaders,
};
