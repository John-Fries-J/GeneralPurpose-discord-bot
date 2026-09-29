const test = require('node:test');
const assert = require('node:assert/strict');
const {
    channelDisplay,
    formatDuration,
    renderLoggingDashboard,
    renderModuleDashboard,
    renderTicketDashboard,
    renderVoiceDashboard,
    summarizeTickets,
} = require('../web/views/components/dashboardPanels');

function fakeGuild() {
    const channels = new Map([
        ['text-1', { id: 'text-1', name: 'logs', isVoiceBased: () => false }],
        ['voice-1', {
            id: 'voice-1',
            name: 'Marsden voice',
            isVoiceBased: () => true,
            userLimit: 5,
            members: {
                values: () => [
                    { id: 'user-1', user: { bot: false } },
                    { id: 'bot-1', user: { bot: true } },
                ],
            },
        }],
    ]);

    return {
        channels: {
            cache: {
                get: id => channels.get(id),
            },
        },
    };
}

test('dashboard panel helpers summarize ticket state', () => {
    const now = Date.UTC(2026, 8, 29);
    const summary = summarizeTickets([
        { status: 'open', claimedById: 'mod-1' },
        { status: 'open' },
        { status: 'closed', updatedAt: now - 1000 },
        { status: 'deleted', updatedAt: now - (10 * 24 * 60 * 60 * 1000) },
    ], now);

    assert.deepEqual(summary, {
        total: 4,
        open: 2,
        claimed: 1,
        unclaimed: 1,
        recentlyClosed: 1,
    });
});

test('dashboard panel helpers format operational displays', () => {
    assert.equal(formatDuration(65), '1m');
    assert.equal(formatDuration(3660), '1h 1m');
    assert.equal(channelDisplay(fakeGuild(), 'voice-1'), '[voice] Marsden voice');
    assert.equal(channelDisplay(fakeGuild(), ''), 'Not set');
});

test('dashboard module dashboard renders status and configure routes', () => {
    const html = renderModuleDashboard([
        ['ticket', [{ data: { name: 'close' } }, { data: { name: 'ticketembed' } }]],
        ['moderation', [{ data: { name: 'warn' } }]],
    ], {
        modules: { moderation: false },
    }, [
        { command: 'close' },
        { command: 'warn' },
        { command: 'warn' },
    ]);

    assert.match(html, /Ticket panels/);
    assert.match(html, /href="\/tickets"/);
    assert.match(html, /Disabled/);
    assert.match(html, /2 uses \/ 30d/);
});

test('dashboard ticket dashboard renders compact management table', () => {
    const html = renderTicketDashboard([
        {
            channelId: 'ticket-1',
            openerTag: 'Marsden#0001',
            claimedByTag: 'Mod#0001',
            status: 'open',
            updatedAt: Date.UTC(2026, 8, 29),
        },
    ], []);

    assert.match(html, /Open Tickets/);
    assert.match(html, /Marsden#0001/);
    assert.match(html, /Mod#0001/);
});

test('dashboard voice and logging dashboards use cached Discord names', () => {
    const guild = fakeGuild();
    const voiceHtml = renderVoiceDashboard([
        {
            channelId: 'voice-1',
            ownerId: 'user-1',
            locked: true,
            userLimit: 0,
            createdAt: Date.UTC(2026, 8, 29),
        },
    ], [], guild);
    const loggingHtml = renderLoggingDashboard({
        logChannels: {
            moderation: 'text-1',
        },
    }, guild);

    assert.match(voiceHtml, /\[voice\] Marsden voice/);
    assert.match(voiceHtml, /1 \/ 5/);
    assert.match(voiceHtml, /Locked/);
    assert.match(loggingHtml, /# logs/);
    assert.doesNotMatch(loggingHtml, /text-1/);
});
