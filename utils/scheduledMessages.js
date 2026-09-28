const { EmbedBuilder } = require('discord.js');
const { appendDashboardLog } = require('./dashboardLogs');
const { listDueScheduledMessages, updateScheduledMessageStatus } = require('./store');

function buildScheduledPayload(record) {
    const payload = {};
    if (record.content) payload.content = record.content;

    if (record.embed) {
        const embed = new EmbedBuilder();
        if (record.embed.color) embed.setColor(record.embed.color);
        if (record.embed.title) embed.setTitle(record.embed.title);
        if (record.embed.description) embed.setDescription(record.embed.description);
        if (record.embed.url) embed.setURL(record.embed.url);
        if (record.embed.thumbnail) embed.setThumbnail(record.embed.thumbnail);
        if (record.embed.image) embed.setImage(record.embed.image);
        if (record.embed.footer) embed.setFooter({ text: record.embed.footer });
        if (Array.isArray(record.embed.fields) && record.embed.fields.length) {
            embed.addFields(record.embed.fields.slice(0, 25));
        }
        payload.embeds = [embed];
    }

    return payload;
}

async function dispatchScheduledMessage(client, record) {
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.send) {
        throw new Error('Channel is not sendable or could not be fetched.');
    }

    await channel.send(buildScheduledPayload(record));
}

async function runScheduledMessages(client) {
    const due = await listDueScheduledMessages();
    let sent = 0;
    let failed = 0;

    for (const record of due) {
        try {
            await updateScheduledMessageStatus(record.id, 'sending');
            await dispatchScheduledMessage(client, record);
            await updateScheduledMessageStatus(record.id, 'sent');
            appendDashboardLog('Scheduled message sent', { channelId: record.channelId, scheduledMessageId: record.id });
            sent += 1;
        } catch (error) {
            await updateScheduledMessageStatus(record.id, 'failed', error.message);
            appendDashboardLog('Scheduled message failed', { channelId: record.channelId, scheduledMessageId: record.id, error: error.message });
            failed += 1;
        }
    }

    return { due: due.length, sent, failed };
}

function startScheduledMessageScheduler(client) {
    const run = () => runScheduledMessages(client).catch(error => console.error('Scheduled message scheduler failed:', error));
    run();
    return setInterval(run, 30 * 1000);
}

module.exports = {
    buildScheduledPayload,
    dispatchScheduledMessage,
    runScheduledMessages,
    startScheduledMessageScheduler,
};
