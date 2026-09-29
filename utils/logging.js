const { createEmbed } = require('./embeds');
const { findSendableChannel, truncate } = require('./discord');
const { getConfig } = require('./config');
const { appendDashboardLog } = require('./dashboardLogs');
const { getGuildSettings } = require('./guildConfig');

const channelKeys = {
    general: 'logChannel',
    moderation: 'moderation',
    ticket: 'ticket',
    suggestion: 'suggestion',
    directMessage: 'directMessage',
    messageDelete: 'messageDelete',
    messageUpdate: 'editMessage',
    threadCreate: 'threadCreate',
    threadDelete: 'threadDelete',
    threadUpdate: 'threadUpdate',
};

function getLogChannel(guild, type = 'general', config = getConfig()) {
    const channelKey = channelKeys[type] || channelKeys.general;
    const channelId = config.logChannels?.[channelKey] || config.logChannels?.logChannel;
    return findSendableChannel(guild, channelId, 'logs');
}

function getLoggingSettings(config = getConfig()) {
    return {
        showUserAvatars: config.logging?.showUserAvatars !== false,
    };
}

function getUserAvatar(user) {
    return user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || null;
}

function getLogAuthor(user) {
    if (!user) return null;

    const author = { name: formatUser(user) };
    const iconURL = getUserAvatar(user);
    if (iconURL) author.iconURL = iconURL;
    return author;
}

async function sendLog(guild, options = {}) {
    const config = guild?.id ? await getGuildSettings(guild.id) : getConfig();
    const settings = getLoggingSettings(config);

    appendDashboardLog(options.title || 'Log event', {
        type: options.type || 'general',
        guildId: guild?.id,
        description: options.description ? truncate(options.description, 500) : '',
    });

    const channel = getLogChannel(guild, options.type, config);
    if (!channel) return false;

    const embed = createEmbed({
        title: options.title,
        description: options.description ? truncate(options.description, 4096) : null,
        author: settings.showUserAvatars ? getLogAuthor(options.user) : null,
        color: options.color || 'blue',
        fields: options.fields,
    });

    await channel.send(options.files?.length ? { embeds: [embed], files: options.files } : { embeds: [embed] });
    return true;
}

function formatUser(user) {
    if (!user) return 'Unknown';
    return `${user.tag || user.username} (${user.id})`;
}

module.exports = {
    formatUser,
    getLogChannel,
    sendLog,
};
