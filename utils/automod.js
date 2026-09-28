const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { addUserHistory, countActiveModerationCases, createModerationCase } = require('./store');
const { sendLog, formatUser } = require('./logging');
const { getOrCreateMuteRole, muteMemberWithRole } = require('./moderation');
const { upsertTempMute } = require('./store');

const invitePattern = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const domainPattern = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.)+[a-z]{2,}\S*/gi;

function getAutoModConfig(config = getConfig()) {
    return {
        enabled: config.autoMod?.enabled === true,
        deleteMatches: config.autoMod?.deleteMatches !== false,
        rules: {
            inviteLinks: config.autoMod?.rules?.inviteLinks !== false,
            massMentions: config.autoMod?.rules?.massMentions !== false,
            caps: config.autoMod?.rules?.caps !== false,
            spam: config.autoMod?.rules?.spam !== false,
            suspiciousDomains: config.autoMod?.rules?.suspiciousDomains !== false,
        },
        massMentionLimit: Number(config.autoMod?.massMentionLimit || 6),
        capsMinLength: Number(config.autoMod?.capsMinLength || 18),
        capsPercent: Number(config.autoMod?.capsPercent || 0.75),
        repeatCharacterLimit: Number(config.autoMod?.repeatCharacterLimit || 8),
        suspiciousDomains: Array.isArray(config.autoMod?.suspiciousDomains) ? config.autoMod.suspiciousDomains : [],
        exemptRoleIds: Array.isArray(config.autoMod?.exemptRoleIds) ? config.autoMod.exemptRoleIds : [],
        escalation: Array.isArray(config.autoMod?.escalation) ? config.autoMod.escalation : [],
        appealUrl: config.moderation?.appealUrl || '',
    };
}

function isExempt(message, settings) {
    return message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)
        || settings.exemptRoleIds.some(roleId => message.member?.roles?.cache?.has(roleId));
}

function capsRatio(content) {
    const letters = content.replace(/[^a-z]/gi, '');
    if (!letters.length) return 0;
    const upper = letters.replace(/[^A-Z]/g, '');
    return upper.length / letters.length;
}

function findAutomodViolation(message, settings = getAutoModConfig()) {
    const content = message.content || '';

    if (settings.rules.inviteLinks && invitePattern.test(content)) {
        return { rule: 'inviteLinks', reason: 'Discord invite link detected.' };
    }

    if (settings.rules.massMentions && message.mentions.users.size + message.mentions.roles.size >= settings.massMentionLimit) {
        return { rule: 'massMentions', reason: `Mass mentions detected (${message.mentions.users.size + message.mentions.roles.size}).` };
    }

    if (settings.rules.caps && content.length >= settings.capsMinLength && capsRatio(content) >= settings.capsPercent) {
        return { rule: 'caps', reason: 'Excessive caps detected.' };
    }

    const repeatedCharacter = content.match(new RegExp(`(.)\\1{${Math.max(2, settings.repeatCharacterLimit - 1)},}`));
    if (settings.rules.spam && repeatedCharacter?.[1]?.trim()) {
        return { rule: 'spam', reason: 'Repeated-character spam detected.' };
    }

    if (settings.rules.suspiciousDomains && settings.suspiciousDomains.length) {
        const domains = [...content.matchAll(domainPattern)].map(match => match[0].toLowerCase());
        const matched = domains.find(domain => settings.suspiciousDomains.some(blocked => domain.includes(String(blocked).toLowerCase())));
        if (matched) return { rule: 'suspiciousDomains', reason: `Suspicious domain detected: ${matched}` };
    }

    return null;
}

async function applyEscalation(message, violation, settings) {
    const warnings = await countActiveModerationCases(message.guild.id, message.author.id, 'automod');
    const step = settings.escalation
        .map(item => ({ ...item, after: Number(item.after || item.warns || 0) }))
        .filter(item => item.after && warnings >= item.after)
        .sort((a, b) => Number(b.after) - Number(a.after))[0];

    if (!step || !message.member) return null;

    if (step.action === 'mute') {
        const durationMs = Number(step.durationMs || 10 * 60 * 1000);
        const muteRole = await getOrCreateMuteRole(message.guild);
        const removedRoleIds = await muteMemberWithRole(message.member, muteRole);
        await upsertTempMute({
            guildId: message.guild.id,
            userId: message.author.id,
            reason: `Auto-mod escalation: ${violation.reason}`,
            moderatorId: message.client.user.id,
            removedRoleIds,
            muteRoleId: muteRole.id,
            expiresAt: Date.now() + durationMs,
            createdAt: Date.now(),
        });
        return `Muted for ${Math.round(durationMs / 60000)} minute(s)`;
    }

    if (step.action === 'kick' && message.member.kickable) {
        await message.member.kick(`Auto-mod escalation: ${violation.reason}`);
        return 'Kicked';
    }

    if (step.action === 'ban' && message.member.bannable) {
        await message.member.ban({ reason: `Auto-mod escalation: ${violation.reason}`, deleteMessageSeconds: 60 * 60 });
        return 'Banned';
    }

    return null;
}

async function handleAutoModMessage(message) {
    const settings = getAutoModConfig();
    if (!settings.enabled || !message.guild || message.author?.bot || isExempt(message, settings)) return false;

    const violation = findAutomodViolation(message, settings);
    if (!violation) return false;

    if (settings.deleteMatches) {
        await message.delete().catch(() => null);
    }

    const caseRecord = await createModerationCase({
        guildId: message.guild.id,
        type: 'automod',
        userId: message.author.id,
        userTag: message.author.tag,
        moderatorId: message.client.user.id,
        moderatorTag: message.client.user.tag,
        reason: violation.reason,
    });
    const escalation = await applyEscalation(message, violation, settings).catch(error => {
        console.error('Auto-mod escalation failed:', error);
        return null;
    });

    await addUserHistory({
        guildId: message.guild.id,
        userId: message.author.id,
        userTag: message.author.tag,
        type: `automod:${violation.rule}`,
        summary: `${violation.reason}${escalation ? ` Escalation: ${escalation}.` : ''}`,
        channelId: message.channelId,
        moderatorId: message.client.user.id,
        metadata: {
            caseId: caseRecord.id,
            messageId: message.id,
            content: message.content?.slice(0, 500) || '',
        },
    });

    await sendLog(message.guild, {
        type: 'moderation',
        title: 'Auto-mod action',
        color: 'orange',
        user: message.author,
        fields: [
            { name: 'Case', value: `#${caseRecord.id}`, inline: true },
            { name: 'Rule', value: violation.rule, inline: true },
            { name: 'User', value: formatUser(message.author), inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Action', value: `${settings.deleteMatches ? 'Message deleted' : 'Logged only'}${escalation ? `, ${escalation}` : ''}` },
            { name: 'Reason', value: violation.reason },
        ],
    }).catch(() => null);

    if (settings.appealUrl) {
        await message.author.send(`A message was removed in **${message.guild.name}** by auto-mod.\nReason: ${violation.reason}\nAppeal: ${settings.appealUrl}`).catch(() => null);
    }

    return true;
}

module.exports = {
    findAutomodViolation,
    getAutoModConfig,
    handleAutoModMessage,
};
