const { PermissionFlagsBits } = require('discord.js');

async function createSoftbanInvite(guild, reason) {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) return null;

    const channel = guild.channels.cache.find(candidate => {
        if (!candidate?.createInvite) return false;
        const permissions = candidate.permissionsFor(botMember);
        return permissions?.has(PermissionFlagsBits.CreateInstantInvite);
    });

    if (!channel) return null;

    return channel.createInvite({
        maxAge: 24 * 60 * 60,
        maxUses: 1,
        unique: true,
        reason,
    });
}

async function sendSoftbanInviteDm(user, guild, invite, reason) {
    const lines = [
        `You have been softbanned from **${guild.name}**.`,
        `Reason: ${reason}`,
        '',
        `You may rejoin with this invite: ${invite.url}`,
    ];

    await user.send(lines.join('\n'));
}

async function softbanUser(guild, userId, options = {}) {
    const reason = options.reason || 'Softban';
    const deleteMessageSeconds = Number(options.deleteMessageSeconds ?? 7 * 24 * 60 * 60);
    const user = await guild.client.users.fetch(userId);
    const invite = await createSoftbanInvite(guild, `Softban invite for ${user.tag || user.id}: ${reason}`);

    if (!invite) {
        throw new Error('I could not create an invite link for this softban.');
    }

    let dmSent = true;
    try {
        await sendSoftbanInviteDm(user, guild, invite, reason);
    } catch {
        dmSent = false;
    }

    await guild.members.ban(userId, { reason, deleteMessageSeconds });
    await guild.members.unban(userId, 'Softban complete');

    return {
        dmSent,
        invite,
        user,
    };
}

module.exports = {
    createSoftbanInvite,
    sendSoftbanInviteDm,
    softbanUser,
};
