const test = require('node:test');
const assert = require('node:assert/strict');
const { emitDomainEvent, eventMatchesScope } = require('../services/domainEvents');

test('activity realtime events stay scoped by guild', () => {
    const event = emitDomainEvent('music:queue-update', {}, { guildId: '111111111111', channelId: '222222222222' });

    assert.equal(eventMatchesScope(event, { guildId: '111111111111' }), true);
    assert.equal(eventMatchesScope(event, { guildId: '333333333333' }), false);
});

test('activity realtime events can be scoped by channel when both sides specify one', () => {
    const event = emitDomainEvent('voice:updated', {}, { guildId: '111111111111', channelId: '222222222222' });

    assert.equal(eventMatchesScope(event, { guildId: '111111111111', channelId: '222222222222' }), true);
    assert.equal(eventMatchesScope(event, { guildId: '111111111111', channelId: '333333333333' }), false);
});
