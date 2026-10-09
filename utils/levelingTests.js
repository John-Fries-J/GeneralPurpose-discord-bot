const {
    adjustUserXp,
    createLevelTestSession,
    getLevelTestSession,
    getUserLevelRecord,
    listLevelTestSessions,
    updateLevelTestSession,
} = require('./store');
const {
    getGuildLevelingConfig,
    getLevelProgress,
    getTotalXp,
    getXpForLevel,
    syncRewardRoles,
} = require('./leveling');

function managedRoleIds(settings) {
    return settings.roleRewards.map(reward => reward.roleId).filter(Boolean);
}

function memberManagedRoles(member, roleIds) {
    return roleIds.filter(roleId => member?.roles?.cache?.has(roleId));
}

function describeTarget(record, settings) {
    const progress = getLevelProgress(record, settings);
    return {
        level: progress.level,
        totalXp: progress.totalXp,
        textXp: Number(record?.textXp || 0),
        voiceXp: Number(record?.voiceXp || 0),
    };
}

async function previewLevelTest(member, options = {}) {
    const settings = await getGuildLevelingConfig(member.guild.id);
    const current = await getUserLevelRecord(member.guild.id, member.id);
    const targetXp = options.level !== undefined
        ? getXpForLevel(options.level, settings)
        : Math.max(0, getTotalXp(current) + Number(options.amount || 0));
    const delta = targetXp - getTotalXp(current);
    const simulated = {
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        textXp: Math.max(0, Number(current?.textXp || 0) + delta),
        voiceXp: Number(current?.voiceXp || 0),
    };
    const rolePlan = await syncRewardRoles(member, simulated, settings, {
        awardMissingRoles: options.awardMissingRoles === true,
        removeObsoleteRoles: options.removeObsoleteRoles === true,
        dryRun: true,
        force: true,
    });

    return {
        before: describeTarget(current, settings),
        after: describeTarget(simulated, settings),
        delta,
        rolePlan,
        managedRoleIds: managedRoleIds(settings),
    };
}

async function createXpTest(member, options = {}) {
    const settings = await getGuildLevelingConfig(member.guild.id);
    const previous = await getUserLevelRecord(member.guild.id, member.id);
    const previousTotal = getTotalXp(previous);
    const targetXp = options.level !== undefined
        ? getXpForLevel(options.level, settings)
        : Math.max(0, previousTotal + Number(options.amount || 0));
    const delta = targetXp - previousTotal;
    const roleIds = managedRoleIds(settings);
    const session = await createLevelTestSession({
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        adminId: options.adminId,
        previewOnly: options.previewOnly === true,
        previousTextXp: Number(previous?.textXp || 0),
        previousVoiceXp: Number(previous?.voiceXp || 0),
        xpDelta: delta,
        xpType: 'text',
        managedRoleIds: memberManagedRoles(member, roleIds),
        metadata: {
            reason: options.reason || 'level_test',
            targetXp,
            targetLevel: options.level ?? null,
        },
    });

    if (options.previewOnly === true) {
        return {
            session,
            record: previous,
            roleChanges: await previewLevelTest(member, {
                level: options.level,
                amount: options.amount,
                awardMissingRoles: options.awardMissingRoles,
                removeObsoleteRoles: options.removeObsoleteRoles,
            }),
        };
    }

    const updated = await adjustUserXp({
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        xpType: 'text',
        amount: delta,
        source: 'level_test',
        sourceKey: session.id,
        adminId: options.adminId,
        metadata: {
            targetXp,
            targetLevel: options.level ?? null,
        },
    });

    const roleChanges = options.applyRoles === true
        ? await syncRewardRoles(member, updated, settings, {
            awardMissingRoles: options.awardMissingRoles === true,
            removeObsoleteRoles: options.removeObsoleteRoles === true,
            dryRun: false,
            force: true,
        })
        : { added: [], removed: [], skipped: [], errors: [] };

    const saved = await updateLevelTestSession(session.id, {
        status: 'active',
        addedRoleIds: roleChanges.added,
        removedRoleIds: roleChanges.removed,
    });

    return { session: saved, record: updated, roleChanges };
}

async function rollbackLevelTest(member, options = {}) {
    const sessions = options.sessionId
        ? [await getLevelTestSession(options.sessionId)]
        : await listLevelTestSessions(member.guild.id, { userId: member.id, limit: 20 });
    const session = sessions.find(item => item && item.status === 'active' && item.userId === member.id);
    if (!session) return { ok: false, reason: 'no_active_session' };

    const updated = await adjustUserXp({
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        xpType: session.xpType || 'text',
        amount: -Number(session.xpDelta || 0),
        source: 'level_test_rollback',
        sourceKey: `rollback:${session.id}`,
        adminId: options.adminId || null,
        metadata: {
            sessionId: session.id,
            preservesEarnedXpByDelta: true,
        },
    });

    const added = [];
    const removed = [];
    if (options.restoreRoles !== false) {
        const managed = new Set(session.managedRoleIds || []);
        for (const roleId of session.addedRoleIds || []) {
            if (!managed.has(roleId) && !(session.addedRoleIds || []).includes(roleId)) continue;
            if (member.roles?.cache?.has(roleId)) {
                await member.roles.remove(roleId, 'Level test rollback').catch(() => null);
                removed.push(roleId);
            }
        }
        for (const roleId of session.removedRoleIds || []) {
            if (!managed.has(roleId)) continue;
            if (!member.roles?.cache?.has(roleId)) {
                await member.roles.add(roleId, 'Level test rollback').catch(() => null);
                added.push(roleId);
            }
        }
    }

    const saved = await updateLevelTestSession(session.id, {
        status: 'rolled_back',
        rolledBackAt: Date.now(),
        metadata: {
            ...(session.metadata || {}),
            rollbackAdminId: options.adminId || null,
            rollbackAddedRoleIds: added,
            rollbackRemovedRoleIds: removed,
        },
    });

    return { ok: true, session: saved, record: updated, roleChanges: { added, removed } };
}

module.exports = {
    createXpTest,
    previewLevelTest,
    rollbackLevelTest,
};
