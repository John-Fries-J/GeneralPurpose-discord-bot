const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const sharp = require('sharp');
const rankCardCommand = require('../commands/utility/rankcard');
const {
    RankCardValidationError,
    normalizeHexColor,
    processBackgroundImage,
    renderRankCardFile,
    validateBackgroundAttachment,
} = require('../utils/rankCard');

async function imageBuffer(width = 640, height = 240, color = '#1f2937') {
    return sharp({
        create: {
            width,
            height,
            channels: 3,
            background: color,
        },
    }).png().toBuffer();
}

function tempConfig(directory) {
    return {
        rankCards: {
            dataDir: directory,
        },
    };
}

async function removeDirectory(directory) {
    sharp.cache(false);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            fs.rmSync(directory, { recursive: true, force: true });
            return;
        } catch (error) {
            if (attempt === 7 || error.code !== 'EPERM') throw error;
            await new Promise(resolve => setTimeout(resolve, 75));
        }
    }
}

test('rank-card background validation rejects unsupported and oversized attachments', () => {
    assert.deepEqual(validateBackgroundAttachment({
        url: 'https://cdn.example/background.gif',
        name: 'background.gif',
        contentType: 'image/gif',
        size: 1024,
    }), {
        ok: false,
        message: 'Rank-card backgrounds must be PNG, JPEG, or WebP images.',
    });

    const oversized = validateBackgroundAttachment({
        url: 'https://cdn.example/background.png',
        name: 'background.png',
        contentType: 'image/png',
        size: 5 * 1024 * 1024,
    });
    assert.equal(oversized.ok, false);
    assert.match(oversized.message, /4 MB/);
});

test('rank-card background processing resizes and optimizes uploads under the data directory', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-card-assets-'));

    try {
        const result = await processBackgroundImage(
            await imageBuffer(1200, 600),
            path.join('backgrounds', 'users', 'guild', 'user.webp'),
            { config: tempConfig(directory) },
        );
        const metadata = await sharp(result.path).metadata();

        assert.equal(result.path.startsWith(directory), true);
        assert.equal(metadata.width, 900);
        assert.equal(metadata.height, 300);
        assert.equal(metadata.format, 'webp');
    } finally {
        await removeDirectory(directory);
    }
});

test('rank-card background processing rejects invalid image bytes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-card-invalid-'));

    try {
        await assert.rejects(
            processBackgroundImage(Buffer.from('not an image'), 'bad.webp', { config: tempConfig(directory) }),
            RankCardValidationError,
        );
    } finally {
        await removeDirectory(directory);
    }
});

test('rank-card renderer writes a PNG card and keys cache entries by XP display data', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-card-render-'));
    const config = tempConfig(directory);
    const user = {
        id: 'user-1',
        username: 'UnicodeUser',
        displayName: 'Unicode User',
        displayAvatarURL: () => '',
    };
    const settings = { rankCard: { theme: 'blue' } };
    const baseProgress = {
        level: 3,
        totalXp: 1250,
        currentLevelXp: 900,
        nextLevelXp: 1500,
        progressXp: 350,
        neededXp: 600,
        percent: 350 / 600,
    };

    try {
        const first = await renderRankCardFile({
            guildId: 'guild',
            user,
            progress: baseProgress,
            rank: 4,
            record: { textXp: 1000, voiceXp: 250 },
            settings,
            preference: { accentColor: '#ff00aa' },
            backgrounds: [],
            config,
            fetchImage: async () => null,
        });
        const second = await renderRankCardFile({
            guildId: 'guild',
            user,
            progress: { ...baseProgress, totalXp: 1251, progressXp: 351, percent: 351 / 600 },
            rank: 4,
            record: { textXp: 1001, voiceXp: 250 },
            settings,
            preference: { accentColor: '#ff00aa' },
            backgrounds: [],
            config,
            fetchImage: async () => null,
        });
        const metadata = await sharp(first).metadata();

        assert.equal(metadata.width, 900);
        assert.equal(metadata.height, 300);
        assert.equal(metadata.format, 'png');
        assert.notEqual(path.basename(first), path.basename(second));
    } finally {
        await removeDirectory(directory);
    }
});

test('rank-card accent colors normalize only valid 6-digit hex values', () => {
    assert.equal(normalizeHexColor('#60A5FA'), '#60a5fa');
    assert.equal(normalizeHexColor('60a5fa'), '#60a5fa');
    assert.equal(normalizeHexColor('#12345'), null);
    assert.equal(normalizeHexColor('not-blue'), null);
});

test('server rank-card settings require Manage Server or Administrator', async () => {
    let response = null;
    await rankCardCommand.execute({
        guild: { id: 'guild' },
        user: { id: 'user' },
        memberPermissions: { has: () => false },
        options: {
            getSubcommand: () => 'server-set-accent',
        },
        reply(payload) {
            response = payload;
            return payload;
        },
    });

    assert.match(response.content, /Manage Server/);
    assert.equal(response.flags, 64);
});

test('user background command rejects invalid attachments before downloading', async () => {
    let response = null;
    await rankCardCommand.execute({
        guild: { id: 'guild' },
        user: { id: 'user' },
        memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild },
        options: {
            getSubcommand: () => 'set-background',
            getString: name => (name === 'source' ? 'custom' : null),
            getAttachment: () => ({
                url: 'https://cdn.example/background.gif',
                name: 'background.gif',
                contentType: 'image/gif',
                size: 128,
            }),
        },
        reply(payload) {
            response = payload;
            return payload;
        },
    });

    assert.match(response.content, /PNG, JPEG, or WebP/);
    assert.equal(response.flags, 64);
});
