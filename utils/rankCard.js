const { AttachmentBuilder } = require('discord.js');
const { escapeHtml } = require('./html');
const { formatXp } = require('./leveling');

const themes = {
    blue: { bg: '#101826', panel: '#172234', accent: '#60a5fa', text: '#f8fafc', muted: '#cbd5e1' },
    green: { bg: '#102018', panel: '#17291f', accent: '#4ade80', text: '#f8fafc', muted: '#cbd5e1' },
    slate: { bg: '#111827', panel: '#1f2937', accent: '#f59e0b', text: '#f9fafb', muted: '#d1d5db' },
};

function clampPercent(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function fitText(value, max = 26) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderRankCardSvg({ user, progress, rank, record, settings }) {
    const theme = themes[settings.rankCard?.theme] || themes.blue;
    const percent = clampPercent(progress.percent);
    const barWidth = Math.round(560 * percent);
    const avatar = user.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';
    const textXp = Number(record.textXp || 0);
    const voiceXp = Number(record.voiceXp || 0);
    const background = settings.rankCard?.backgroundUrl
        ? `<image href="${escapeHtml(settings.rankCard.backgroundUrl)}" x="0" y="0" width="900" height="300" preserveAspectRatio="xMidYMid slice" opacity="0.32"/>`
        : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300" viewBox="0 0 900 300" role="img" aria-label="Rank card">
<rect width="900" height="300" rx="8" fill="${theme.bg}"/>
${background}
<rect x="24" y="24" width="852" height="252" rx="8" fill="${theme.panel}" opacity="0.94"/>
<clipPath id="avatarClip"><circle cx="116" cy="116" r="62"/></clipPath>
<circle cx="116" cy="116" r="66" fill="${theme.accent}"/>
${avatar ? `<image href="${escapeHtml(avatar)}" x="54" y="54" width="124" height="124" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>` : `<circle cx="116" cy="116" r="62" fill="${theme.bg}"/>`}
<text x="210" y="76" fill="${theme.text}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${escapeHtml(fitText(user.globalName || user.username || user.tag || user.id))}</text>
<text x="210" y="116" fill="${theme.muted}" font-family="Inter, Arial, sans-serif" font-size="20">Rank ${rank ? `#${rank}` : 'Unranked'} • Level ${progress.level}</text>
<text x="780" y="76" fill="${theme.text}" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" text-anchor="end">${escapeHtml(formatXp(progress.totalXp))} XP</text>
<text x="780" y="112" fill="${theme.muted}" font-family="Inter, Arial, sans-serif" font-size="18" text-anchor="end">${escapeHtml(formatXp(progress.nextLevelXp - progress.totalXp))} XP to next</text>
<rect x="210" y="150" width="560" height="28" rx="6" fill="${theme.bg}"/>
<rect x="210" y="150" width="${barWidth}" height="28" rx="6" fill="${theme.accent}"/>
<text x="210" y="214" fill="${theme.muted}" font-family="Inter, Arial, sans-serif" font-size="18">Text ${escapeHtml(formatXp(textXp))} XP</text>
<text x="420" y="214" fill="${theme.muted}" font-family="Inter, Arial, sans-serif" font-size="18">Voice ${escapeHtml(formatXp(voiceXp))} XP</text>
<text x="210" y="246" fill="${theme.muted}" font-family="Inter, Arial, sans-serif" font-size="18">${escapeHtml(formatXp(progress.progressXp))} / ${escapeHtml(formatXp(progress.neededXp))} XP</text>
</svg>`;
}

function createRankCardAttachment(data) {
    const svg = renderRankCardSvg(data);
    return new AttachmentBuilder(Buffer.from(svg, 'utf8'), { name: 'rank-card.svg' });
}

module.exports = {
    createRankCardAttachment,
    renderRankCardSvg,
};
