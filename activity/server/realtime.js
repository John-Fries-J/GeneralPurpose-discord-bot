const { eventMatchesScope, subscribeDomainEvents } = require('../../services/domainEvents');

function writeEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function openActivityEventStream(req, res, scope) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    writeEvent(res, 'hello', {
        ok: true,
        scope,
        createdAt: Date.now(),
    });

    const unsubscribe = subscribeDomainEvents(event => {
        if (!eventMatchesScope(event, scope)) return;
        writeEvent(res, 'activity', {
            type: event.type,
            payload: event.payload,
            scope: event.scope,
            createdAt: event.createdAt,
        });
    });

    const heartbeat = setInterval(() => {
        writeEvent(res, 'ping', { createdAt: Date.now() });
    }, 25_000);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
}

module.exports = {
    openActivityEventStream,
};
