const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('./config');
const { getStarboardMessage, upsertStarboardMessage } = require('./store');

const rulesAgreementCustomId = 'rules:agree';

function emojiMatches(reactionEmoji, configuredEmoji) {
    return reactionEmoji.id === configuredEmoji || reactionEmoji.name === configuredEmoji || reactionEmoji.toString() === configuredEmoji;
}

async function fetchPartial(value) {
    if (value?.partial) return value.fetch().catch(() => value);
    return value;
}

function findReactionRole(reaction) {
    const panels = Array.isArray(getConfig().reactionRoles?.panels) ? getConfig().reactionRoles.panels : [];
    return panels
        .flatMap(panel => (panel.roles || []).map(role => ({ ...role, messageId: panel.messageId })))
        .find(item => item.messageId === reaction.message.id && emojiMatches(reaction.emoji, item.emoji));
}

async function handleReactionRoleAdd(reaction, user) {
    if (user.bot) return false;
    reaction = await fetchPartial(reaction);
    const match = findReactionRole(reaction);
    if (!match?.roleId || !reaction.message.guild) return false;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return false;
    await member.roles.add(match.roleId, 'Reaction role').catch(() => null);
    return true;
}

async function handleReactionRoleRemove(reaction, user) {
    if (user.bot) return false;
    reaction = await fetchPartial(reaction);
    const match = findReactionRole(reaction);
    if (!match?.roleId || !reaction.message.guild) return false;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return false;
    await member.roles.remove(match.roleId, 'Reaction role removed').catch(() => null);
    return true;
}

async function handleStarboardReaction(reaction, user) {
    if (user.bot) return false;
    reaction = await fetchPartial(reaction);
    const config = getConfig().starboard || {};
    if (config.enabled !== true || !config.channelId || !emojiMatches(reaction.emoji, config.emoji || '⭐')) return false;

    const message = await fetchPartial(reaction.message);
    if (!message.guild || message.author?.bot || message.channelId === config.channelId) return false;

    const threshold = Number(config.threshold || 3);
    if (reaction.count < threshold) return false;

    const starboardChannel = await message.guild.channels.fetch(config.channelId).catch(() => null);
    if (!starboardChannel?.send) return false;

    const existing = await getStarboardMessage(message.guild.id, message.id);
    const embed = new EmbedBuilder()
        .setColor(0xf2c94c)
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL?.() })
        .setDescription(message.content || '[No text content]')
        .addFields(
            { name: 'Source', value: `[Jump to message](${message.url})`, inline: true },
            { name: 'Stars', value: String(reaction.count), inline: true },
        )
        .setTimestamp(message.createdAt);

    const firstImage = message.attachments.find(attachment => attachment.contentType?.startsWith('image/'));
    if (firstImage) embed.setImage(firstImage.url);

    if (existing?.starboardMessageId) {
        const starboardMessage = await starboardChannel.messages.fetch(existing.starboardMessageId).catch(() => null);
        if (starboardMessage) {
            await starboardMessage.edit({ content: `${config.emoji || '⭐'} **${reaction.count}** <#${message.channelId}>`, embeds: [embed] });
            await upsertStarboardMessage({ ...existing, count: reaction.count });
            return true;
        }
    }

    const sent = await starboardChannel.send({ content: `${config.emoji || '⭐'} **${reaction.count}** <#${message.channelId}>`, embeds: [embed] });
    await upsertStarboardMessage({
        guildId: message.guild.id,
        messageId: message.id,
        channelId: message.channelId,
        starboardChannelId: starboardChannel.id,
        starboardMessageId: sent.id,
        count: reaction.count,
    });
    return true;
}

async function handleRulesAgreementButton(interaction) {
    if (!interaction.isButton?.() || interaction.customId !== rulesAgreementCustomId) return false;

    const config = getConfig().rulesAgreement || {};
    if (config.enabled !== true || !config.roleId) {
        await interaction.reply({ content: 'Rules agreement is not configured.', flags: 64 });
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        await interaction.reply({ content: 'I could not find your server membership.', flags: 64 });
        return true;
    }

    await member.roles.add(config.roleId, 'Rules agreement accepted');
    await interaction.reply({ content: 'Rules accepted. Your role has been updated.', flags: 64 });
    return true;
}

module.exports = {
    handleReactionRoleAdd,
    handleReactionRoleRemove,
    handleRulesAgreementButton,
    handleStarboardReaction,
    rulesAgreementCustomId,
};
