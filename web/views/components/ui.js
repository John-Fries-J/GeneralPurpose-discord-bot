const { escapeHtml } = require('./html');

function renderPageHeader({
    title,
    description = '',
    eyebrow = '',
    notice = '',
    actions = '',
}) {
    return `
${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
<div class="page-header">
<div>
${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
<h1>${escapeHtml(title)}</h1>
${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}
</div>
${actions ? `<div class="split-actions">${actions}</div>` : ''}
</div>`;
}

function renderMetricCard(label, value, detail = '') {
    return `<div class="panel metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function renderSectionIntro(title, description) {
    return `<div class="section-intro"><h2>${escapeHtml(title)}</h2>${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}</div>`;
}

module.exports = {
    renderMetricCard,
    renderPageHeader,
    renderSectionIntro,
};
