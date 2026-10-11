const {
    adjustUserXp,
    createLevelTestSession,
    getLevelTestSession,
    getUserLevelRecord,
    listLevelTestSessions,
    updateLevelTestSession,
} = require('./store');
const {
    canManageRole,
    getEarnedRewardRoleIds,
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

function roleObject(member, roleId) {
    return member.guild?.roles?.cache?.get?.(roleId) || { id: roleId };
}

async function removeRollbackRole(member, roleId, roleChanges, reason) {
    const role = roleObject(member, roleId);
    if (!canManageRole(member, role)) {
        roleChanges.skipped.push({ roleId, action: 'remove', reason: 'missing_manage_roles_or_hierarchy' });
        return;
    }
    try {
        await member.roles.remove(roleId, reason);
        roleChanges.removed.push(roleId);
    } catch (error) {
        roleChanges.errors.push({ roleId, action: 'remove', error: error.message });
    }
}

async function addRollbackRole(member, roleId, roleChanges, reason) {
    const role = roleObject(member, roleId);
    if (!canManageRole(member, role)) {
        roleChanges.skipped.push({ roleId, action: 'add', reason: 'missing_manage_roles_or_hierarchy' });
        return;
    }
    try {
        await member.roles.add(roleId, reason);
        roleChanges.added.push(roleId);
    } catch (error) {
        roleChanges.errors.push({ roleId, action: 'add', error: error.message });
    }
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
            allManagedRoleIds: roleIds,
            startingManagedRoleIds: memberManagedRoles(member, roleIds),
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

    const current = await getUserLevelRecord(member.guild.id, member.id);
    const xpType = session.xpType === 'voice' ? 'voice' : 'text';
    const currentTypeXp = Number((xpType === 'voice' ? current?.voiceXp : current?.textXp) || 0);
    const rollbackAmount = Math.max(0, currentTypeXp - Number(session.xpDelta || 0)) - currentTypeXp;
    const updated = await adjustUserXp({
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user?.tag || member.user?.username || member.id,
        xpType,
        amount: rollbackAmount,
        source: 'level_test_rollback',
        sourceKey: `rollback:${session.id}`,
        adminId: options.adminId || null,
        metadata: {
            sessionId: session.id,
            preservesEarnedXpByDelta: true,
            originalXpDelta: Number(session.xpDelta || 0),
        },
    });

    const roleChanges = { added: [], removed: [], skipped: [], errors: [] };
    if (options.restoreRoles !== false) {
        await member.fetch?.().catch(() => null);
        const settings = await getGuildLevelingConfig(member.guild.id);
        const startingManaged = new Set(session.metadata?.startingManagedRoleIds || session.managedRoleIds || []);
        const allManaged = new Set(session.metadata?.allManagedRoleIds || settings.roleRewards.map(reward => reward.roleId).filter(Boolean));
        const earnedAfterRollback = new Set(getEarnedRewardRoleIds(updated, settings));
        for (const roleId of session.addedRoleIds || []) {
            if (!allManaged.has(roleId)) continue;
            if (startingManaged.has(roleId) || earnedAfterRollback.has(roleId)) continue;
            if (member.roles?.cache?.has(roleId)) {
                await removeRollbackRole(member, roleId, roleChanges, 'Level test rollback');
            }
        }
        for (const roleId of session.removedRoleIds || []) {
            if (!allManaged.has(roleId)) continue;
            if (!startingManaged.has(roleId) && !earnedAfterRollback.has(roleId)) continue;
            if (!member.roles?.cache?.has(roleId)) {
                await addRollbackRole(member, roleId, roleChanges, 'Level test rollback');
            }
        }
    }

    const saved = await updateLevelTestSession(session.id, {
        status: 'rolled_back',
        rolledBackAt: Date.now(),
        metadata: {
            ...(session.metadata || {}),
            rollbackAdminId: options.adminId || null,
            rollbackAddedRoleIds: roleChanges.added,
            rollbackRemovedRoleIds: roleChanges.removed,
            rollbackSkippedRoleIds: roleChanges.skipped,
            rollbackRoleErrors: roleChanges.errors,
        },
    });

    return { ok: true, session: saved, record: updated, roleChanges };
}

module.exports = {
    createXpTest,
    previewLevelTest,
    rollbackLevelTest,
};
