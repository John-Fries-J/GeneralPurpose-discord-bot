const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

function parseEmbedColor(value) {
    const color = String(value || '').trim();
    if (!color) return 0x5865f2;
    if (/^#[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16);
    if (/^[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color, 16);
    return 0x5865f2;
}

function parseEmbedFields(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [name, ...rest] = line.split('|');
            return {
                name: (name || 'Field').trim().slice(0, 256),
                value: (rest.join('|') || 'No value').trim().slice(0, 1024),
                inline: false,
            };
        })
        .slice(0, 25);
}

function buildDashboardMessagePayload(body) {
    const content = String(body.content || '').trim();
    const embedTitle = String(body.embedTitle || '').trim();
    const embedDescription = String(body.embedDescription || '').trim();
    const embedUrl = String(body.embedUrl || '').trim();
    const embedThumbnail = String(body.embedThumbnail || '').trim();
    const embedImage = String(body.embedImage || '').trim();
    const embedFooter = String(body.embedFooter || '').trim();
    const embedFields = parseEmbedFields(body.embedFields);
    const hasEmbed = embedTitle || embedDescription || embedUrl || embedThumbnail || embedImage || embedFooter || embedFields.length;
    const payload = {};

    if (content) payload.content = content;
    if (hasEmbed) {
        const embed = {
            color: parseEmbedColor(body.embedColor),
            title: embedTitle,
            description: embedDescription,
            url: embedUrl,
            thumbnail: embedThumbnail,
            image: embedImage,
            footer: embedFooter,
            fields: embedFields,
        };
        payload.embed = embed;
        payload.embeds = [new EmbedBuilder().setColor(embed.color)];
        if (embed.title) payload.embeds[0].setTitle(embed.title);
        if (embed.description) payload.embeds[0].setDescription(embed.description);
        if (embed.url) payload.embeds[0].setURL(embed.url);
        if (embed.thumbnail) payload.embeds[0].setThumbnail(embed.thumbnail);
        if (embed.image) payload.embeds[0].setImage(embed.image);
        if (embed.footer) payload.embeds[0].setFooter({ text: embed.footer });
        if (embed.fields.length) payload.embeds[0].addFields(embed.fields);
    }

    return payload;
}

function buildEmbedFromTemplate(embed) {
    if (!embed) return null;

    const builder = new EmbedBuilder();
    if (embed.color) builder.setColor(embed.color);
    if (embed.title) builder.setTitle(embed.title);
    if (embed.description) builder.setDescription(embed.description);
    if (embed.url) builder.setURL(embed.url);
    if (embed.thumbnail) builder.setThumbnail(embed.thumbnail);
    if (embed.image) builder.setImage(embed.image);
    if (embed.footer) builder.setFooter({ text: embed.footer });
    if (Array.isArray(embed.fields) && embed.fields.length) builder.addFields(embed.fields.slice(0, 25));
    return builder;
}

function channelBelongsToGuild(channel, guild) {
    return Boolean(channel && guild?.id && (channel.guildId === guild.id || channel.guild?.id === guild.id));
}

function botCanSend(channel, guild) {
    if (!channel?.send) return false;
    const botMember = guild?.members?.me;
    if (!channel.permissionsFor || !botMember) return true;
    const permissions = channel.permissionsFor(botMember);
    return permissions?.has?.(PermissionFlagsBits.ViewChannel) !== false
        && permissions?.has?.(PermissionFlagsBits.SendMessages) !== false;
}

async function resolveDashboardChannel(guild, channelId, {
    label = 'Channel',
    types = [],
    requireSendable = false,
} = {}) {
    const id = String(channelId || '').trim();
    if (!id) throw new Error(`${label} is required.`);

    const channel = guild?.channels?.cache?.get?.(id)
        || await guild?.channels?.fetch?.(id).catch(() => null);
    if (!channel || !channelBelongsToGuild(channel, guild)) {
        throw new Error(`${label} is not part of this server.`);
    }
    if (types.length && !types.includes(channel.type)) {
        throw new Error(`${label} has the wrong channel type.`);
    }
    if (requireSendable && !botCanSend(channel, guild)) {
        throw new Error(`${label} is not sendable by the bot.`);
    }

    return channel;
}

module.exports = {
    botCanSend,
    buildDashboardMessagePayload,
    buildEmbedFromTemplate,
    channelBelongsToGuild,
    parseEmbedColor,
    parseEmbedFields,
    resolveDashboardChannel,
};
