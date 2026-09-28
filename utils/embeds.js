const { EmbedBuilder } = require('discord.js');
const colors = require('../colors.json');
const language = require('./language');

function resolveColor(color) {
    const value = colors[color] || color || colors.blue;
    return typeof value === 'string' && !value.startsWith('#') ? `#${value}` : value;
}

function getWatermarkText(prefix) {
    const watermark = language.watermark || {};
    const credit = watermark.userId
        ? `${watermark.text} (${watermark.userId})`
        : watermark.text;

    return prefix ? `${prefix} | ${credit}` : credit;
}

function createEmbed(options = {}) {
    const embed = new EmbedBuilder()
        .setColor(resolveColor(options.color || 'blue'));

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(options.description);
    if (options.author) embed.setAuthor(options.author);
    if (options.url) embed.setURL(options.url);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.fields?.length) embed.addFields(options.fields);
    if (options.timestamp !== false) embed.setTimestamp();

    const footer = { text: getWatermarkText(options.footerText) };
    if (options.footerIcon) footer.iconURL = options.footerIcon;
    embed.setFooter(footer);

    return embed;
}

module.exports = {
    createEmbed,
    getWatermarkText,
    resolveColor,
};
