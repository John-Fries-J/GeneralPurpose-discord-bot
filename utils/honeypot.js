const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./config');
const { createEmbed } = require('./embeds');
const { addUserHistory } = require('./store');

const customIds = {
    softban: userId => `honeypot:softban:${userId}`,
    ban: userId => `honeypot:ban:${userId}`,
    ignore: userId => `honeypot:ignore:${userId}`,
};

function getHoneypotConfig(config = getConfig()) {
    return {
        enabled: config.honeypot?.enabled === true,
        channelId: config.honeypot?.channelId || '',
        alertChannelId: config.honeypot?.alertChannelId || '',
    };
}

function createHoneypotButtons(userId, disabled = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customIds.softban(userId))
            .setLabel('Softban')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(customIds.ban(userId))
            .setLabel('Ban')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(customIds.ignore(userId))
            .setLabel('Ignore')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
    )];
}

function buildAlertEmbed(message, deletedCount, status = 'Pending review') {
    return createEmbed({
        title: 'Scam Alert',
        color: 'red',
        fields: [
            { name: 'User', value: `${message.author.tag} (${message.author.id})` },
            { name: 'Honeypot Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Deleted Messages', value: `${deletedCount}`, inline: true },
            { name: 'Status', value: status },
            { name: 'Trigger Message', value: message.content?.slice(0, 1000) || '[No text content]' },
        ],
    });
}

async function deleteRecentUserMessages(message, limit = 10) {
    const messages = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) return 0;

    const deletable = [...messages.values()]
        .filter(item => item.author?.id === message.author.id)
        .filter(item => item.deletable)
        .slice(0, limit);

    const results = await Promise.allSettled(deletable.map(item => item.delete().catch(() => null)));
    return results.filter(result => result.status === 'fulfilled').length;
}

async function handleHoneypotMessage(message) {
    const settings = getHoneypotConfig();
    if (!settings.enabled || !message.guild || message.author?.bot || message.channelId !== settings.channelId) {
        return false;
    }

    const deletedCount = await deleteRecentUserMessages(message, 10);
    const alertChannel = await message.client.channels.fetch(settings.alertChannelId).catch(() => null);

    await addUserHistory({
        guildId: message.guild.id,
        userId: message.author.id,
        userTag: message.author.tag,
        type: 'honeypot:trigger',
        summary: `Triggered honeypot. Deleted ${deletedCount} recent messages.`,
        channelId: message.channelId,
        metadata: {
            deletedCount,
            triggerMessage: message.content || '',
        },
    }).catch(error => console.error('Failed to record honeypot history:', error));

    if (alertChannel?.send) {
        await alertChannel.send({
            embeds: [buildAlertEmbed(message, deletedCount)],
            components: createHoneypotButtons(message.author.id),
        });
    }

    return true;
}

async function softbanUser(guild, userId, reason = 'Scam') {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    await guild.members.ban(userId, { reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
    await guild.members.unban(userId, reason);
    return user;
}

async function banUser(guild, userId, reason = 'Scam') {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    await guild.members.ban(userId, { reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
    return user;
}

async function handleHoneypotButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('honeypot:') || !interaction.guild) return false;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({ content: 'You need Ban Members to use honeypot actions.', ephemeral: true });
        return true;
    }

    const [, action, userId] = interaction.customId.split(':');
    let status;
    let user = await interaction.client.users.fetch(userId).catch(() => null);

    if (action === 'softban') {
        user = await softbanUser(interaction.guild, userId);
        status = `Softbanned by ${interaction.user.tag}. Reason: Scam`;
    } else if (action === 'ban') {
        user = await banUser(interaction.guild, userId);
        status = `Banned by ${interaction.user.tag}. Reason: Scam`;
    } else if (action === 'ignore') {
        status = `Ignored by ${interaction.user.tag}.`;
    } else {
        return false;
    }

    await addUserHistory({
        guildId: interaction.guild.id,
        userId,
        userTag: user?.tag || userId,
        type: `honeypot:${action}`,
        summary: status,
        channelId: interaction.channelId,
        moderatorId: interaction.user.id,
    });

    const existingEmbed = interaction.message.embeds[0];
    const updatedEmbed = createEmbed({
        title: existingEmbed?.title || 'Scam Alert',
        color: action === 'ignore' ? 'blue' : 'red',
        fields: [
            ...(existingEmbed?.fields || []).filter(field => field.name !== 'Status'),
            { name: 'Status', value: status },
        ],
    });

    await interaction.update({
        embeds: [updatedEmbed],
        components: createHoneypotButtons(userId, true),
    });

    return true;
}

module.exports = {
    buildAlertEmbed,
    createHoneypotButtons,
    customIds,
    getHoneypotConfig,
    handleHoneypotButton,
    handleHoneypotMessage,
};
