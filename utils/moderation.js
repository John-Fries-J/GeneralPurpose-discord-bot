const language = require('./language');
const { createEmbed } = require('./embeds');
const { fetchMember, safeDm } = require('./discord');
const { sendLog, formatUser } = require('./logging');

function isSelfAction(interaction, user) {
    return user.id === interaction.user.id;
}

function isOwnerAction(interaction, user) {
    return user.id === interaction.guild.ownerId;
}

function isHigherOrEqualRole(interaction, member) {
    if (!member || interaction.guild.ownerId === interaction.user.id) return false;
    return member.roles.highest.position >= interaction.member.roles.highest.position;
}

async function validateTarget(interaction, user, capability) {
    const member = await fetchMember(interaction.guild, user.id);

    if (isSelfAction(interaction, user)) {
        return { ok: false, member, message: language.moderation.cannotModerateSelf };
    }

    if (isOwnerAction(interaction, user)) {
        return { ok: false, member, message: language.moderation.cannotModerateOwner };
    }

    if (isHigherOrEqualRole(interaction, member)) {
        return { ok: false, member, message: language.moderation.cannotModerateHigherRole };
    }

    if (!member) {
        return { ok: false, member, message: language.moderation.userNotInServer };
    }

    if (capability && !member[capability]) {
        return { ok: false, member, message: language.moderation.cannotModerateUser };
    }

    return { ok: true, member };
}

async function sendModerationDm(user, options) {
    const embed = createEmbed({
        title: options.title,
        description: options.description,
        color: options.color,
    });

    return safeDm(user, { embeds: [embed] });
}

async function logModerationAction(interaction, options) {
    return sendLog(interaction.guild, {
        type: 'moderation',
        title: options.title,
        color: options.color,
        fields: [
            { name: 'User', value: options.user ? formatUser(options.user) : 'Unknown', inline: true },
            { name: 'Moderator', value: formatUser(interaction.user), inline: true },
            { name: 'Reason', value: options.reason || language.general.noReason },
            ...(options.extraFields || []),
        ],
    }).catch(error => {
        console.error('Failed to send moderation log:', error);
        return false;
    });
}

module.exports = {
    logModerationAction,
    sendModerationDm,
    validateTarget,
};
