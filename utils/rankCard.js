const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const { getConfig } = require('./config');
const { formatXp } = require('./leveling');

sharp.cache({ memory: 32, files: 0, items: 64 });

const CARD_WIDTH = 900;
const CARD_HEIGHT = 300;
const AVATAR_SIZE = 132;
const MAX_BACKGROUND_BYTES = 4 * 1024 * 1024;
const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 16_000_000;
const CACHE_MAX_FILES = 200;
const CACHE_MAX_BYTES = 75 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 2;

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const supportedSharpFormats = new Set(['jpeg', 'png', 'webp']);

const themes = {
    blue: { accent: '#60a5fa', accentAlt: '#38bdf8' },
    green: { accent: '#4ade80', accentAlt: '#22c55e' },
    slate: { accent: '#f59e0b', accentAlt: '#fbbf24' },
};

class RankCardValidationError extends Error {
    constructor(message, code = 'invalid_rank_card_image') {
        super(message);
        this.name = 'RankCardValidationError';
        this.code = code;
    }
}

function ensureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function resolveRankCardRoot(config = getConfig()) {
    return path.resolve(__dirname, '..', config.rankCards?.dataDir || 'data/rank-cards');
}

function resolveRankCardPath(relativePath, config = getConfig()) {
    const root = resolveRankCardRoot(config);
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Rank card asset path escapes the data directory.');
    }
    return resolved;
}

function rankCardRelativePath(...segments) {
    return path.join(...segments.map(segment => String(segment).replace(/[^0-9A-Za-z._-]/g, '_')));
}

function getUserBackgroundAssetPath(guildId, userId) {
    return rankCardRelativePath('backgrounds', 'users', guildId, `${userId}.webp`);
}

function getServerBackgroundAssetPath(guildId, backgroundId) {
    return rankCardRelativePath('backgrounds', 'guilds', guildId, `${backgroundId}.webp`);
}

function normalizeBackgroundId(name) {
    const raw = String(name || '').trim();
    const slug = raw
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 32)
        .replace(/^-|-$/g, '');
    if (slug) return slug;
    return `background-${crypto.createHash('sha256').update(raw || String(Date.now())).digest('hex').slice(0, 8)}`;
}

function normalizeHexColor(value) {
    const input = String(value || '').trim();
    const match = input.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return null;
    return `#${match[1].toLowerCase()}`;
}

function isRecognizedImageAttachment(attachment) {
    const type = String(attachment?.contentType || '').toLowerCase().split(';')[0];
    const name = String(attachment?.name || attachment?.url || '').toLowerCase();
    return supportedImageTypes.has(type) || /\.(jpe?g|png|webp)(\?|$)/i.test(name);
}

function validateBackgroundAttachment(attachment, options = {}) {
    const maxBytes = options.maxBytes || MAX_BACKGROUND_BYTES;
    if (!attachment?.url) {
        return { ok: false, message: 'Attach a PNG, JPEG, or WebP image.' };
    }
    if (!isRecognizedImageAttachment(attachment)) {
        return { ok: false, message: 'Rank-card backgrounds must be PNG, JPEG, or WebP images.' };
    }
    if (Number(attachment.size || 0) > maxBytes) {
        return { ok: false, message: `Rank-card backgrounds must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.` };
    }
    return { ok: true };
}

function createByteLimitStream(maxBytes) {
    let total = 0;
    return new Transform({
        transform(chunk, encoding, callback) {
            total += chunk.length;
            if (total > maxBytes) {
                callback(new RankCardValidationError(`Rank-card backgrounds must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`, 'rank_card_image_too_large'));
                return;
            }
            callback(null, chunk);
        },
    });
}

function assertSupportedMetadata(metadata) {
    if (!supportedSharpFormats.has(metadata.format)) {
        throw new RankCardValidationError('Rank-card backgrounds must be PNG, JPEG, or WebP images.');
    }
    if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 80) {
        throw new RankCardValidationError('Rank-card backgrounds must be at least 160x80 pixels.');
    }
}

async function processBackgroundBuffer(buffer, outputPath, options = {}) {
    if (!Buffer.isBuffer(buffer)) throw new RankCardValidationError('Invalid image upload.');
    if (buffer.length > (options.maxBytes || MAX_BACKGROUND_BYTES)) {
        throw new RankCardValidationError(`Rank-card backgrounds must be ${Math.floor((options.maxBytes || MAX_BACKGROUND_BYTES) / 1024 / 1024)} MB or smaller.`, 'rank_card_image_too_large');
    }

    let metadata;
    try {
        metadata = await sharp(buffer, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        assertSupportedMetadata(metadata);
    } catch (error) {
        if (error instanceof RankCardValidationError) throw error;
        throw new RankCardValidationError('That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.');
    }
    ensureDirectory(path.dirname(outputPath));
    const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    await sharp(buffer, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre', withoutEnlargement: false })
        .webp({ quality: 82, effort: 4 })
        .toFile(temporaryPath);
    fs.renameSync(temporaryPath, outputPath);
    return {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        bytes: fs.statSync(outputPath).size,
    };
}

async function processBackgroundFile(inputPath, outputPath) {
    let metadata;
    try {
        metadata = await sharp(inputPath, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        assertSupportedMetadata(metadata);
    } catch (error) {
        if (error instanceof RankCardValidationError) throw error;
        throw new RankCardValidationError('That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.');
    }

    const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await sharp(inputPath, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS })
            .rotate()
            .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre', withoutEnlargement: false })
            .webp({ quality: 82, effort: 4 })
            .toFile(temporaryPath);
        fs.renameSync(temporaryPath, outputPath);
    } catch {
        fs.rmSync(temporaryPath, { force: true });
        throw new RankCardValidationError('That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.');
    }
    return {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        bytes: fs.statSync(outputPath).size,
    };
}

async function processBackgroundStream(stream, outputPath, options = {}) {
    ensureDirectory(path.dirname(outputPath));
    const temporaryInputPath = `${outputPath}.${process.pid}.${Date.now()}.upload`;

    try {
        await pipeline(
            stream,
            createByteLimitStream(options.maxBytes || MAX_BACKGROUND_BYTES),
            fs.createWriteStream(temporaryInputPath),
        );
        return await processBackgroundFile(temporaryInputPath, outputPath);
    } catch (error) {
        if (error instanceof RankCardValidationError) throw error;
        throw new RankCardValidationError('That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.');
    } finally {
        fs.rmSync(temporaryInputPath, { force: true });
    }
}

async function processBackgroundImage(input, relativeAssetPath, options = {}) {
    const outputPath = resolveRankCardPath(relativeAssetPath, options.config);
    const result = Buffer.isBuffer(input)
        ? await processBackgroundBuffer(input, outputPath, options)
        : await processBackgroundStream(input, outputPath, options);
    return {
        ...result,
        assetPath: relativeAssetPath,
        path: outputPath,
    };
}

async function processBackgroundAttachment(attachment, relativeAssetPath, options = {}) {
    const validation = validateBackgroundAttachment(attachment, options);
    if (!validation.ok) throw new RankCardValidationError(validation.message);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);

    try {
        const response = await fetch(attachment.url, { signal: controller.signal });
        if (!response.ok || !response.body) {
            throw new RankCardValidationError('The uploaded background could not be downloaded from Discord.');
        }
        const contentLength = Number(response.headers.get('content-length') || attachment.size || 0);
        if (contentLength > (options.maxBytes || MAX_BACKGROUND_BYTES)) {
            throw new RankCardValidationError(`Rank-card backgrounds must be ${Math.floor((options.maxBytes || MAX_BACKGROUND_BYTES) / 1024 / 1024)} MB or smaller.`, 'rank_card_image_too_large');
        }
        const contentType = String(response.headers.get('content-type') || attachment.contentType || '').toLowerCase().split(';')[0];
        if (contentType && !supportedImageTypes.has(contentType) && attachment.contentType) {
            throw new RankCardValidationError('Rank-card backgrounds must be PNG, JPEG, or WebP images.');
        }
        return await processBackgroundImage(Readable.fromWeb(response.body), relativeAssetPath, options);
    } catch (error) {
        if (error instanceof RankCardValidationError) throw error;
        throw new RankCardValidationError('The uploaded background could not be downloaded from Discord.');
    } finally {
        clearTimeout(timeout);
    }
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function truncateText(value, maxCharacters) {
    const characters = Array.from(String(value || ''));
    if (characters.length <= maxCharacters) return characters.join('');
    return `${characters.slice(0, maxCharacters - 1).join('')}...`;
}

function displayNameForUser(user) {
    return truncateText(user?.globalName || user?.displayName || user?.username || user?.tag || `User ${user?.id || ''}`.trim(), 28);
}

function initialsForUser(user) {
    const characters = Array.from(displayNameForUser(user).replace(/[^\p{L}\p{N}]/gu, ''));
    return escapeXml((characters.slice(0, 2).join('') || '?').toUpperCase());
}

function percentLabel(progress) {
    return `${Math.round(clamp(progress?.percent, 0, 1) * 100)}%`;
}

function buildDefaultBackgroundSvg(accent = '#60a5fa') {
    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101827"/>
      <stop offset="0.48" stop-color="#172033"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${escapeXml(accent)}" stop-opacity="0.58"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0.24"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#base)"/>
  <path d="M-80 260 C120 170 178 332 392 212 C590 100 674 126 980 24 L980 320 L-80 320 Z" fill="url(#accent)" opacity="0.82"/>
  <path d="M568 -30 C678 72 778 46 948 98 L948 -30 Z" fill="${escapeXml(accent)}" opacity="0.30"/>
  <path d="M-60 42 C120 12 242 48 362 4" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="42"/>
</svg>`);
}

function buildOverlaySvg({ user, progress, rank, record, accent, accentAlt }) {
    const safePercent = clamp(progress.percent, 0, 1);
    const barWidth = Math.round(520 * safePercent);
    const textXp = Number(record?.textXp || 0);
    const voiceXp = Number(record?.voiceXp || 0);
    const xpToNext = Math.max(0, Number(progress.nextLevelXp || 0) - Number(progress.totalXp || 0));
    const currentXp = formatXp(progress.totalXp);
    const neededXp = formatXp(xpToNext);

    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${escapeXml(accent)}"/>
      <stop offset="1" stop-color="${escapeXml(accentAlt)}"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#020617" flood-opacity="0.38"/>
    </filter>
  </defs>
  <rect x="20" y="20" width="860" height="260" rx="18" fill="#020617" opacity="0.50" filter="url(#softShadow)"/>
  <rect x="24" y="24" width="852" height="252" rx="16" fill="#111827" opacity="0.54"/>
  <circle cx="118" cy="126" r="76" fill="#020617" opacity="0.62"/>
  <circle cx="118" cy="126" r="72" fill="none" stroke="${escapeXml(accent)}" stroke-width="5"/>
  <text x="220" y="78" fill="#f8fafc" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(displayNameForUser(user))}</text>
  <text x="220" y="113" fill="#cbd5e1" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="18" font-weight="500">Rank ${rank ? `#${rank}` : 'Unranked'}  -  Level ${Number(progress.level || 0)}</text>
  <text x="812" y="80" fill="#f8fafc" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="30" font-weight="800" text-anchor="end">${escapeXml(currentXp)} XP</text>
  <text x="812" y="113" fill="#cbd5e1" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="17" text-anchor="end">${escapeXml(neededXp)} XP to next</text>
  <rect x="220" y="148" width="520" height="30" rx="15" fill="#020617" opacity="0.82"/>
  <rect x="220" y="148" width="${barWidth}" height="30" rx="15" fill="url(#bar)"/>
  <text x="760" y="171" fill="#f8fafc" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="18" font-weight="700">${percentLabel(progress)}</text>
  <text x="220" y="212" fill="#e2e8f0" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(formatXp(progress.progressXp))} / ${escapeXml(formatXp(progress.neededXp))} XP</text>
  <text x="220" y="244" fill="#cbd5e1" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="16">Text ${escapeXml(formatXp(textXp))} XP</text>
  <text x="392" y="244" fill="#cbd5e1" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="16">Voice ${escapeXml(formatXp(voiceXp))} XP</text>
  <text x="812" y="244" fill="#cbd5e1" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="16" text-anchor="end">Next level at ${escapeXml(formatXp(progress.nextLevelXp))} XP</text>
</svg>`);
}

function buildPlaceholderAvatarSvg(user, accent) {
    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}">
  <defs>
    <linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${escapeXml(accent)}"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <circle cx="66" cy="66" r="66" fill="url(#avatar)"/>
  <text x="66" y="78" text-anchor="middle" fill="#ffffff" font-family="'Noto Sans', 'Segoe UI', Arial, sans-serif" font-size="42" font-weight="800">${initialsForUser(user)}</text>
</svg>`);
}

function buildCircleMaskSvg(size) {
    return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
}

async function fetchRemoteImage(url, maxBytes = MAX_AVATAR_BYTES) {
    if (!url) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) return null;
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > maxBytes) return null;

        const chunks = [];
        let total = 0;
        for await (const chunk of Readable.fromWeb(response.body)) {
            total += chunk.length;
            if (total > maxBytes) return null;
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function userAvatarUrl(user) {
    try {
        return user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: true }) || null;
    } catch {
        return null;
    }
}

async function renderAvatar(user, accent, fetchImage = fetchRemoteImage) {
    const avatarUrl = userAvatarUrl(user);
    const avatarBuffer = await fetchImage(avatarUrl, MAX_AVATAR_BYTES);
    if (!avatarBuffer) return sharp(buildPlaceholderAvatarSvg(user, accent)).png().toBuffer();

    try {
        const rounded = await sharp(avatarBuffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
            .composite([{ input: buildCircleMaskSvg(AVATAR_SIZE), blend: 'dest-in' }])
            .png()
            .toBuffer();
        return rounded;
    } catch {
        return sharp(buildPlaceholderAvatarSvg(user, accent)).png().toBuffer();
    }
}

function resolveAccent(settings = {}, preference = null) {
    const userAccent = normalizeHexColor(preference?.accentColor);
    if (userAccent) return userAccent;
    const serverAccent = normalizeHexColor(settings.rankCard?.accentColor);
    if (serverAccent) return serverAccent;
    const theme = themes[settings.rankCard?.theme] || themes.blue;
    return theme.accent;
}

function resolveAccentAlt(settings = {}, accent) {
    const theme = themes[settings.rankCard?.theme] || themes.blue;
    return normalizeHexColor(settings.rankCard?.accentAltColor) || theme.accentAlt || accent;
}

function findBackground(backgrounds = [], backgroundId) {
    if (!backgroundId) return null;
    return backgrounds.find(background => background.backgroundId === backgroundId || background.name === backgroundId) || null;
}

function resolveBackgroundAsset({ guildId, userId, preference, settings, backgrounds = [], config = getConfig() }) {
    if (preference?.backgroundType === 'custom') {
        const assetPath = getUserBackgroundAssetPath(guildId, userId);
        const absolutePath = resolveRankCardPath(assetPath, config);
        if (fs.existsSync(absolutePath)) return { type: 'custom', key: 'custom', path: absolutePath };
    }

    if (preference?.backgroundType === 'server') {
        const background = findBackground(backgrounds, preference.backgroundKey);
        if (background?.assetPath) {
            const absolutePath = resolveRankCardPath(background.assetPath, config);
            if (fs.existsSync(absolutePath)) return { type: 'server', key: background.backgroundId, path: absolutePath };
        }
    }

    const defaultId = settings.rankCard?.defaultBackgroundId || settings.rankCard?.backgroundId || '';
    const background = findBackground(backgrounds, defaultId);
    if (background?.assetPath) {
        const absolutePath = resolveRankCardPath(background.assetPath, config);
        if (fs.existsSync(absolutePath)) return { type: 'server-default', key: background.backgroundId, path: absolutePath };
    }

    return { type: 'generated-default', key: 'generated-default', path: null };
}

function fileFingerprint(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return {
        path: path.basename(filePath),
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
    };
}

function buildCacheKey(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 32);
}

function collectCacheFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectCacheFiles(fullPath);
        if (!entry.isFile() || path.extname(entry.name) !== '.png') return [];
        const stat = fs.statSync(fullPath);
        return [{ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs }];
    });
}

function pruneRankCardCache(config = getConfig()) {
    const cacheDirectory = resolveRankCardPath('cache', config);
    const now = Date.now();
    const files = collectCacheFiles(cacheDirectory).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let total = 0;
    let kept = 0;

    for (const file of files) {
        total += file.size;
        kept += 1;
        if (now - file.mtimeMs > CACHE_MAX_AGE_MS || kept > CACHE_MAX_FILES || total > CACHE_MAX_BYTES) {
            fs.rmSync(file.path, { force: true });
        }
    }
}

async function loadBackgroundBuffer(background, accent) {
    if (background.path) {
        try {
            return await sharp(background.path)
                .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
                .png()
                .toBuffer();
        } catch {
            return await sharp(buildDefaultBackgroundSvg(accent)).png().toBuffer();
        }
    }
    return sharp(buildDefaultBackgroundSvg(accent)).png().toBuffer();
}

async function renderRankCardFile({
    guildId,
    user,
    progress,
    rank,
    record,
    settings,
    preference = null,
    backgrounds = [],
    config = getConfig(),
    fetchImage = fetchRemoteImage,
} = {}) {
    const accent = resolveAccent(settings, preference);
    const accentAlt = resolveAccentAlt(settings, accent);
    const background = resolveBackgroundAsset({ guildId, userId: user?.id, preference, settings, backgrounds, config });
    const avatarUrl = userAvatarUrl(user);
    const fingerprint = {
        version: CACHE_VERSION,
        guildId,
        userId: user?.id,
        displayName: displayNameForUser(user),
        avatarUrl,
        level: Number(progress.level || 0),
        totalXp: Number(progress.totalXp || 0),
        progressXp: Number(progress.progressXp || 0),
        neededXp: Number(progress.neededXp || 0),
        nextLevelXp: Number(progress.nextLevelXp || 0),
        rank: rank || null,
        textXp: Number(record?.textXp || 0),
        voiceXp: Number(record?.voiceXp || 0),
        accent,
        accentAlt,
        background: {
            type: background.type,
            key: background.key,
            file: fileFingerprint(background.path),
        },
    };
    const hash = buildCacheKey(fingerprint);
    const cachePath = resolveRankCardPath(rankCardRelativePath('cache', guildId || 'global', `${hash}.png`), config);
    if (fs.existsSync(cachePath)) return cachePath;

    ensureDirectory(path.dirname(cachePath));
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    const backgroundBuffer = await loadBackgroundBuffer(background, accent);
    const avatarBuffer = await renderAvatar(user, accent, fetchImage);
    const overlay = buildOverlaySvg({ user, progress, rank, record, accent, accentAlt });
    const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#020617" opacity="0.35"/></svg>`);

    await sharp(backgroundBuffer)
        .composite([
            { input: shade, top: 0, left: 0 },
            { input: overlay, top: 0, left: 0 },
            { input: avatarBuffer, top: 60, left: 52 },
        ])
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(temporaryPath);
    fs.renameSync(temporaryPath, cachePath);
    pruneRankCardCache(config);
    return cachePath;
}

async function createRankCardAttachment(data) {
    const filePath = await renderRankCardFile(data);
    return new AttachmentBuilder(filePath, { name: 'rank-card.png' });
}

module.exports = {
    CARD_HEIGHT,
    CARD_WIDTH,
    MAX_BACKGROUND_BYTES,
    RankCardValidationError,
    createRankCardAttachment,
    getServerBackgroundAssetPath,
    getUserBackgroundAssetPath,
    normalizeBackgroundId,
    normalizeHexColor,
    processBackgroundAttachment,
    processBackgroundImage,
    pruneRankCardCache,
    renderRankCardFile,
    resolveBackgroundAsset,
    resolveRankCardPath,
    resolveRankCardRoot,
    validateBackgroundAttachment,
};
