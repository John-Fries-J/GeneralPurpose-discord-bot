const { parseDuration } = require('../utils/duration');
const { fetchMember } = require('../utils/discord');
const { createEmbed } = require('../utils/embeds');
const language = require('../utils/language');
const {
    getOrCreateMuteRole,
    logModerationAction,
    muteMemberWithRole,
    sendModerationDm,
    validateTarget,
} = require('../utils/moderation');
const { addModNote, addUserHistory, removeTempBan, upsertTempBan, upsertTempMute } = require('../utils/store');

function failed(message) {
    return { ok: false, message };
}

function withNoReason(reason) {
    return reason?.trim() || language.general.noReason;
}

async function warn(interaction, { user, reason }) {
    const finalReason = withNoReason(reason);
    const target = await validateTarget(interaction, user);

    if (!target.ok) return failed(target.message);

    const dmSent = await sendModerationDm(user, {
        title: 'User Warned',
        description: `You have been warned in **${interaction.guild.name}**.\n**Reason:** ${finalReason}`,
        color: 'orange',
    });

    await logModerationAction(interaction, {
        caseType: 'warn',
        title: 'User warned',
        color: 'orange',
        user,
        reason: finalReason,
        extraFields: [{ name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true }],
    });

    return {
        ok: true,
        dmSent,
        embed: createEmbed({
            title: 'User Warned',
            description: `**${user.tag}** has been warned.\n**Reason:** ${finalReason}`,
            color: 'orange',
        }),
        reason: finalReason,
    };
}

async function kick(interaction, { user, reason }) {
    const finalReason = withNoReason(reason);
    const target = await validateTarget(interaction, user, 'kickable');

    if (!target.ok) {
        return failed(target.message === language.moderation.cannotModerateUser ? language.moderation.cannotKick : target.message);
    }

    const dmSent = await sendModerationDm(user, {
        title: 'User Kicked',
        description: `You have been kicked from **${interaction.guild.name}**.\n**Reason:** ${finalReason}`,
        color: 'red',
    });

    await target.member.kick(finalReason);
    await logModerationAction(interaction, {
        caseType: 'kick',
        title: 'User kicked',
        color: 'red',
        user,
        reason: finalReason,
        extraFields: [{ name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true }],
    });

    return {
        ok: true,
        dmSent,
        content: `User ${user.tag} has been kicked. Reason: ${finalReason}${dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
        reason: finalReason,
    };
}

async function ban(interaction, {
    user,
    reason,
    duration = null,
    deleteDays = 0,
}) {
    const finalReason = withNoReason(reason);
    const finalDuration = duration?.trim() || null;

    if (finalDuration && !parseDuration(finalDuration)) return failed(language.moderation.invalidDuration);

    const member = await fetchMember(interaction.guild, user.id);
    if (member) {
        const target = await validateTarget(interaction, user, 'bannable');
        if (!target.ok) {
            return failed(target.message === language.moderation.cannotModerateUser ? language.moderation.cannotBan : target.message);
        }
    }

    const dmSent = await sendModerationDm(user, {
        title: 'User Banned',
        description: `You have been banned from **${interaction.guild.name}**.\n**Reason:** ${finalReason}`,
        color: 'red',
    });

    await interaction.guild.bans.create(user.id, {
        reason: finalReason,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
    });

    await logModerationAction(interaction, {
        caseType: finalDuration ? 'tempban' : 'ban',
        title: 'User banned',
        color: 'red',
        user,
        reason: finalReason,
        duration: finalDuration,
        extraFields: [
            { name: 'Duration', value: finalDuration || 'Permanent', inline: true },
            { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
        ],
    });

    if (finalDuration) {
        await upsertTempBan({
            guildId: interaction.guild.id,
            userId: user.id,
            reason: finalReason,
            moderatorId: interaction.user.id,
            expiresAt: Date.now() + parseDuration(finalDuration),
            createdAt: Date.now(),
        });
    }

    return {
        ok: true,
        dmSent,
        content: `User ${user.tag} has been banned. Reason: ${finalReason}${dmSent ? '' : `\n${language.moderation.dmFailed}`}`,
        duration: finalDuration,
        reason: finalReason,
    };
}

async function mute(interaction, { user, duration, reason }) {
    const finalReason = withNoReason(reason);
    const durationInMs = parseDuration(duration);
    const target = await validateTarget(interaction, user, 'moderatable');

    if (!target.ok) {
        return failed(target.message === language.moderation.cannotModerateUser ? language.moderation.cannotMute : target.message);
    }

    if (!durationInMs) return failed(language.moderation.invalidDuration);

    const muteRole = await getOrCreateMuteRole(interaction.guild);
    const removedRoleIds = await muteMemberWithRole(target.member, muteRole);
    const expiresAt = Date.now() + durationInMs;

    await upsertTempMute({
        guildId: interaction.guild.id,
        userId: user.id,
        reason: finalReason,
        moderatorId: interaction.user.id,
        removedRoleIds,
        muteRoleId: muteRole.id,
        expiresAt,
        createdAt: Date.now(),
    });

    const dmSent = await sendModerationDm(user, {
        title: 'User Muted',
        description: `You have been muted in **${interaction.guild.name}** for ${duration}.\n**Reason:** ${finalReason}`,
        color: 'orange',
    });

    await logModerationAction(interaction, {
        caseType: 'mute',
        title: 'User muted',
        color: 'orange',
        user,
        reason: finalReason,
        duration,
        extraFields: [
            { name: 'Duration', value: duration, inline: true },
            { name: 'Removed roles', value: `${removedRoleIds.length}`, inline: true },
            { name: 'DM sent', value: dmSent ? 'Yes' : 'No', inline: true },
        ],
    });

    return {
        ok: true,
        dmSent,
        embed: createEmbed({
            title: 'User Muted',
            description: `**${target.member.user.tag}** has been muted for ${duration}.\n**Reason:** ${finalReason}`,
            color: 'orange',
        }),
        duration,
        reason: finalReason,
    };
}

async function unban(interaction, { userId, reason }) {
    const finalUserId = String(userId || '').trim();
    const finalReason = withNoReason(reason || 'Unbanned');
    if (!/^\d{5,32}$/.test(finalUserId)) return failed('Enter a valid Discord user ID.');

    try {
        const user = await interaction.guild.members.unban(finalUserId, finalReason);
        await removeTempBan(interaction.guild.id, finalUserId);
        await logModerationAction(interaction, {
            caseType: 'unban',
            title: 'User unbanned',
            color: 'green',
            user,
            reason: finalReason,
        });

        return {
            ok: true,
            content: `${user.tag || user.id} has been unbanned. ${language.moderation.caseLogged}`,
            reason: finalReason,
            user,
        };
    } catch (error) {
        return failed('I could not unban that user. Make sure the ID is correct and the user is banned.');
    }
}

async function addNote(interaction, { user, note, source = 'command' }) {
    const noteText = String(note || '').trim();
    if (!noteText) return failed('Moderator note cannot be empty.');

    const saved = await addModNote({
        guildId: interaction.guild.id,
        userId: user.id,
        userTag: user.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        note: noteText,
    });

    await addUserHistory({
        guildId: interaction.guild.id,
        userId: user.id,
        userTag: user.tag,
        type: 'modnote',
        summary: saved.note,
        channelId: interaction.channelId,
        moderatorId: interaction.user.id,
        metadata: { noteId: saved.id, source },
    });

    return {
        ok: true,
        note: saved,
        content: `Saved mod note ${saved.id} for ${user.tag || user.id}.`,
    };
}

module.exports = {
    addNote,
    ban,
    kick,
    mute,
    unban,
    warn,
};
