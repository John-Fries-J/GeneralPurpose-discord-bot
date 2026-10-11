const { EventEmitter } = require('node:events');

const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(100);

function normalizeScope(scope = {}) {
    return {
        guildId: scope.guildId ? String(scope.guildId) : null,
        channelId: scope.channelId ? String(scope.channelId) : null,
        userId: scope.userId ? String(scope.userId) : null,
        instanceId: scope.instanceId ? String(scope.instanceId) : null,
    };
}

function emitDomainEvent(type, payload = {}, scope = {}) {
    const event = {
        type,
        payload,
        scope: normalizeScope(scope),
        createdAt: Date.now(),
    };

    domainEvents.emit('event', event);
    return event;
}

function subscribeDomainEvents(listener) {
    domainEvents.on('event', listener);
    return () => domainEvents.off('event', listener);
}

function eventMatchesScope(event, scope = {}) {
    const eventScope = event?.scope || {};
    if (scope.guildId && eventScope.guildId && String(scope.guildId) !== String(eventScope.guildId)) return false;
    if (scope.channelId && eventScope.channelId && String(scope.channelId) !== String(eventScope.channelId)) return false;
    if (scope.userId && eventScope.userId && String(scope.userId) !== String(eventScope.userId)) return false;
    if (scope.instanceId && eventScope.instanceId && String(scope.instanceId) !== String(eventScope.instanceId)) return false;
    return true;
}

module.exports = {
    emitDomainEvent,
    eventMatchesScope,
    subscribeDomainEvents,
};
