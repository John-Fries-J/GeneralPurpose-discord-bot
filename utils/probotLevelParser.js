const DEFAULT_PROBOT_AUTHOR_ID = '282859044593598464';
const DEFAULT_PROBOT_SOURCE_CHANNEL_ID = '1127798346246017165';
const PARSER_VERSION = 'probot-level-announcement-v1';
const MAX_LEVEL = 10000;

const levelPatterns = [
    /\b(?:you(?:['’]ve| have)?|has|have)?\s*(?:just\s+)?(?:reached|hit|achieved)\s+\*{0,2}level\s+(\d{1,5})\b/iu,
    /\b(?:leveled|levelled)\s+up\s+(?:to\s+)?\*{0,2}level\s+(\d{1,5})\b/iu,
    /\bnow\s+\*{0,2}level\s+(\d{1,5})\b/iu,
];

function cleanText(value = '') {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function embedFieldText(field) {
    return [field?.name, field?.value].filter(Boolean).join('\n');
}

function getEmbedTexts(message) {
    const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
    const texts = [];
    embeds.forEach((embed, index) => {
        const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
        for (const [name, value] of [
            ['title', data?.title],
            ['description', data?.description],
            ['footer', data?.footer?.text],
            ['author', data?.author?.name],
        ]) {
            const text = cleanText(value);
            if (text) texts.push({ source: `embed_${index}_${name}`, text });
        }
        const fields = Array.isArray(data?.fields) ? data.fields : [];
        fields.forEach((field, fieldIndex) => {
            const text = cleanText(embedFieldText(field));
            if (text) texts.push({ source: `embed_${index}_field_${fieldIndex}`, text });
        });
    });
    return texts;
}

function messageTexts(message) {
    const texts = [];
    const content = cleanText(message?.content || '');
    if (content) texts.push({ source: 'content', text: content });
    texts.push(...getEmbedTexts(message));
    return texts;
}

function collectMentionIds(message, text) {
    const ids = new Set();
    const users = message?.mentions?.users;
    if (users?.keys) {
        for (const id of users.keys()) ids.add(String(id));
    } else if (Array.isArray(users)) {
        for (const user of users) {
            if (user?.id) ids.add(String(user.id));
        }
    }

    for (const match of String(text || '').matchAll(/<@!?(\d{15,25})>/g)) {
        ids.add(match[1]);
    }
    return [...ids];
}

function findLevel(text) {
    const matches = [];
    for (const pattern of levelPatterns) {
        const match = pattern.exec(text);
        if (match) matches.push(Number(match[1]));
    }
    const levels = [...new Set(matches.filter(level => Number.isInteger(level)))];
    if (!levels.length) return { ok: false, reason: 'no_level_pattern' };
    if (levels.length > 1) return { ok: false, reason: 'ambiguous_level', levels };
    const level = levels[0];
    if (level <= 0 || level > MAX_LEVEL) return { ok: false, reason: 'invalid_level', level };
    return { ok: true, level };
}

function unresolvedNameFromText(text) {
    const withoutMentions = cleanText(text.replace(/<@!?\d{15,25}>/g, ''));
    const commaIndex = withoutMentions.indexOf(',');
    if (commaIndex <= 0) return null;
    const prefix = cleanText(withoutMentions.slice(0, commaIndex));
    if (!prefix || /^\W+$/.test(prefix)) return null;
    return prefix.slice(0, 100);
}

function invalid(status, diagnostic = {}) {
    return {
        ok: false,
        parseStatus: status,
        confidence: 'none',
        parserVersion: PARSER_VERSION,
        targetUserId: null,
        announcedLevel: null,
        contentSource: diagnostic.contentSource || null,
        diagnostic,
    };
}

function parseTextSource(message, source) {
    const text = source.text;
    const level = findLevel(text);
    if (!level.ok) {
        return invalid(level.reason === 'invalid_level' ? 'invalid_level' : (level.reason === 'ambiguous_level' ? 'ambiguous_level' : 'invalid_format'), {
            contentSource: source.source,
            reason: level.reason,
            levels: level.levels || undefined,
            level: level.level || undefined,
        });
    }

    const mentionIds = collectMentionIds(message, text);
    if (mentionIds.length === 1) {
        return {
            ok: true,
            parseStatus: 'verified',
            confidence: 'high',
            parserVersion: PARSER_VERSION,
            targetUserId: mentionIds[0],
            announcedLevel: level.level,
            contentSource: source.source,
            diagnostic: {
                matchedPattern: 'reached_level',
                mentionIds,
            },
        };
    }

    if (mentionIds.length > 1) {
        return invalid('ambiguous_identity', {
            contentSource: source.source,
            reason: 'multiple_user_mentions',
            mentionIds,
            announcedLevel: level.level,
        });
    }

    const unresolvedName = unresolvedNameFromText(text);
    return {
        ok: false,
        parseStatus: 'unresolved_identity',
        confidence: 'unresolved',
        parserVersion: PARSER_VERSION,
        targetUserId: null,
        announcedLevel: level.level,
        contentSource: source.source,
        diagnostic: {
            reason: 'no_user_id_mention',
            unresolvedName,
        },
    };
}

function parseProBotLevelAnnouncement(message, options = {}) {
    const probotAuthorId = String(options.probotAuthorId || DEFAULT_PROBOT_AUTHOR_ID);
    if (String(message?.author?.id || '') !== probotAuthorId) {
        return invalid('non_probot_author', {
            reason: 'author_mismatch',
            authorId: message?.author?.id || null,
            expectedAuthorId: probotAuthorId,
        });
    }

    const texts = messageTexts(message);
    if (!texts.length) return invalid('invalid_format', { reason: 'empty_message' });

    const parsed = texts.map(source => parseTextSource(message, source));
    const verified = parsed.filter(result => result.parseStatus === 'verified');
    if (verified.length === 1) return verified[0];
    if (verified.length > 1) {
        const signatures = new Set(verified.map(result => `${result.targetUserId}:${result.announcedLevel}`));
        if (signatures.size === 1) return verified[0];
        return invalid('ambiguous_identity', {
            reason: 'multiple_verified_sources',
            candidates: verified.map(result => ({
                targetUserId: result.targetUserId,
                announcedLevel: result.announcedLevel,
                contentSource: result.contentSource,
            })),
        });
    }

    const unresolved = parsed.find(result => result.parseStatus === 'unresolved_identity');
    if (unresolved) return unresolved;

    const invalidLevel = parsed.find(result => result.parseStatus === 'invalid_level');
    if (invalidLevel) return invalidLevel;

    const ambiguous = parsed.find(result => ['ambiguous_identity', 'ambiguous_level'].includes(result.parseStatus));
    if (ambiguous) return ambiguous;

    return invalid('invalid_format', {
        reason: 'no_supported_announcement_format',
        sources: parsed.map(result => result.diagnostic?.contentSource).filter(Boolean),
    });
}

module.exports = {
    DEFAULT_PROBOT_AUTHOR_ID,
    DEFAULT_PROBOT_SOURCE_CHANNEL_ID,
    MAX_LEVEL,
    PARSER_VERSION,
    parseProBotLevelAnnouncement,
};
