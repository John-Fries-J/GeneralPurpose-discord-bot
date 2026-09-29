const test = require('node:test');
const assert = require('node:assert/strict');
const { renderLayout, renderNav } = require('../web/views/layout');
const { renderMetricCard, renderPageHeader } = require('../web/views/components/ui');

test('dashboard layout renders grouped navigation and external assets', () => {
    const html = renderLayout('Dashboard', '<section>Body</section>', { username: 'Admin' }, {
        user: {
            username: 'GeneralPurpose',
            displayAvatarURL: () => 'https://cdn.example/avatar.png',
        },
        isReady: () => true,
        ws: { ping: 42 },
    }, 'tickets', {
        guild: { name: 'Marsden Server' },
    });

    assert.match(html, /href="\/dashboard\.css"/);
    assert.match(html, /src="\/dashboard\.js"/);
    assert.match(html, />Server</);
    assert.match(html, />Moderation</);
    assert.match(html, /Marsden Server/);
    assert.match(html, /Online - 42ms/);
    assert.match(html, /class="active" href="\/tickets">Tickets/);
});

test('dashboard components escape display text', () => {
    const nav = renderNav('overview');
    const header = renderPageHeader({
        title: '<Dashboard>',
        description: 'Manage <everything>',
        eyebrow: 'Server',
    });
    const metric = renderMetricCard('A&B', '<5');

    assert.match(nav, /Overview/);
    assert.match(header, /&lt;Dashboard&gt;/);
    assert.match(header, /Manage &lt;everything&gt;/);
    assert.match(metric, /A&amp;B/);
    assert.match(metric, /&lt;5/);
});
