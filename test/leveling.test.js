const test = require('node:test');
const assert = require('node:assert/strict');
const {
    allowsTextXp,
    allowsVoiceXp,
    deterministicHistoricalXp,
    formatProgressBar,
    getLevelProgress,
    getLevelingConfig,
    getTotalXp,
    getXpForLevel,
    inferLevelFromRoles,
    isVoiceEligible,
    reconcileLevelEstimates,
    syncRewardRoles,
} = require('../utils/leveling');
const { calculateMessageEstimates } = require('../utils/levelingImport');

test('level mode helpers respect text, voice, and both modes', () => {
    assert.equal(allowsTextXp({ enabled: true, mode: 'text' }), true);
    assert.equal(allowsVoiceXp({ enabled: true, mode: 'text' }), false);
    assert.equal(allowsTextXp({ enabled: true, mode: 'both' }), true);
    assert.equal(allowsVoiceXp({ enabled: true, mode: 'both' }), true);
    assert.equal(allowsVoiceXp({ enabled: false, mode: 'voice' }), false);
});

test('getTotalXp combines text and voice XP', () => {
    assert.equal(getTotalXp({ textXp: 10, voiceXp: 5 }), 15);
});

test('level progress uses cumulative XP thresholds', () => {
    const settings = { xpPerLevelBase: 100, progressionFormula: 'legacy' };

    assert.equal(getXpForLevel(0, settings), 0);
    assert.equal(getXpForLevel(1, settings), 100);
    assert.equal(getXpForLevel(2, settings), 300);

    assert.deepEqual(getLevelProgress({ textXp: 125, voiceXp: 0 }, settings), {
        level: 1,
        totalXp: 125,
        currentLevelXp: 100,
        nextLevelXp: 300,
        progressXp: 25,
        neededXp: 200,
        percent: 0.125,
    });
});

test('configurable formulas preserve legacy defaults and support ProBot-inspired estimates', () => {
    const legacy = getLevelingConfig({ leveling: { xpPerLevelBase: 100 } });
    const probotStyle = getLevelingConfig({ leveling: { xpProfile: 'probot_inspired' } });

    assert.equal(getXpForLevel(2, legacy), 300);
    assert.equal(probotStyle.textXpMin, 15);
    assert.equal(probotStyle.textXpMax, 25);
    assert.equal(probotStyle.progressionFormula, 'probot_inspired');
    assert.notEqual(getXpForLevel(5, probotStyle), getXpForLevel(5, legacy));
});

test('historical XP uses a stable profile-based pseudo-random amount', () => {
    const profile = { textXpMin: 15, textXpMax: 25, cooldownSeconds: 60, progressionFormula: 'legacy' };

    assert.equal(
        deterministicHistoricalXp('guild', 'message-1', profile),
        deterministicHistoricalXp('guild', 'message-1', profile),
    );
    assert.notEqual(
        deterministicHistoricalXp('guild', 'message-1', { ...profile, textXpMin: 15, textXpMax: 15 }),
        deterministicHistoricalXp('guild', 'message-1', { ...profile, textXpMin: 16, textXpMax: 16 }),
    );
});

test('historical message estimates are calculated chronologically across channels', () => {
    const messages = [
        { userId: 'user', messageId: 'later', channelId: 'b', createdAt: 60_000, xpAmount: 10, eligible: true },
        { userId: 'user', messageId: 'cooldown', channelId: 'a', createdAt: 30_000, xpAmount: 10, eligible: true },
        { userId: 'user', messageId: 'early', channelId: 'a', createdAt: 0, xpAmount: 10, eligible: true },
    ];
    const estimates = calculateMessageEstimates(messages, { cooldownSeconds: 60 });

    assert.equal(estimates.get('user').xp, 20);
    assert.deepEqual(estimates.get('user').messageIds, ['early', 'later']);
});

test('role-to-level inference uses the highest mapped role and never sums roles', () => {
    const member = { roles: { cache: new Map([['level-5', {}], ['level-20', {}]]) } };
    const mappings = [
        { roleId: 'level-5', minimumLevel: 5 },
        { roleId: 'level-10', minimumLevel: 10 },
        { roleId: 'level-20', minimumLevel: 20 },
    ];

    assert.equal(inferLevelFromRoles(member, mappings), 20);
});

test('reconciliation keeps the highest safe estimate and never lowers existing XP', () => {
    const settings = { xpPerLevelBase: 100, progressionFormula: 'legacy' };

    assert.equal(reconcileLevelEstimates({
        existingXp: 0,
        messageEstimatedXp: getXpForLevel(14, settings),
        roleMinLevel: 20,
        settings,
    }).finalXp, getXpForLevel(20, settings));

    assert.equal(reconcileLevelEstimates({
        existingXp: getXpForLevel(50, settings),
        messageEstimatedXp: getXpForLevel(10, settings),
        roleMinLevel: 20,
        settings,
    }).finalXp, getXpForLevel(50, settings));
});

test('voice eligibility can exclude AFK, deafened, and solo users', () => {
    const channel = {
        id: 'voice',
        members: new Map([['user', { user: { bot: false } }]]),
    };
    const member = {
        id: 'user',
        user: { bot: false },
        guild: { afkChannelId: 'voice' },
        roles: { cache: new Map() },
        voice: { selfDeaf: true },
    };
    const settings = getLevelingConfig({
        leveling: {
            enabled: true,
            voiceEligibility: { allowAfk: false, allowDeafened: false, allowSolo: false },
        },
    });

    assert.equal(isVoiceEligible(member, channel, settings), false);
});

test('reward role sync reports hierarchy and permission skips without touching unrelated roles', async () => {
    const roleAdds = [];
    const member = {
        id: 'user',
        guild: {
            members: { me: { permissions: { has: () => false } } },
            roles: { cache: new Map([['reward', { id: 'reward', position: 1 }]]) },
        },
        roles: {
            cache: new Map([['unrelated', {}]]),
            add: async roleId => roleAdds.push(roleId),
            remove: async () => null,
        },
    };
    const settings = getLevelingConfig({
        leveling: {
            roleRewards: [{ level: 1, roleId: 'reward' }],
        },
    });

    const result = await syncRewardRoles(member, { textXp: 100, voiceXp: 0 }, settings, { force: true });

    assert.equal(result.skipped.length, 1);
    assert.deepEqual(roleAdds, []);
    assert.equal(member.roles.cache.has('unrelated'), true);
});

test('formatProgressBar renders fixed width progress', () => {
    assert.equal(formatProgressBar(0.5, 10), '[#####-----]');
    assert.equal(formatProgressBar(2, 10), '[##########]');
    assert.equal(formatProgressBar(-1, 10), '[----------]');
});
