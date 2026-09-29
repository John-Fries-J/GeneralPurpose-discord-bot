const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ModalBuilder,
    PermissionsBitField,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');
const language = require('./language');
const { createEmbed } = require('./embeds');
const { getConfig } = require('./config');
const { formatTemplate } = require('./template');
const { isGuildTextChannel } = require('./discord');
const { sendLog, formatUser } = require('./logging');
const { getGuildSettings, updateTicketSettings } = require('./guildConfig');
const { escapeHtml } = require('./html');
const { createTicketTranscript, deleteTicketRecord, getTicketRecord, listTicketRecords, upsertTicketRecord } = require('./store');

const customIds = {
    open: 'ticket:open',
    close: 'ticket:close',
    closeModal: 'ticket:modal:close',
    delete: 'ticket:delete',
    claim: 'ticket:claim',
    addUser: 'ticket:user:add',
    removeUser: 'ticket:user:remove',
    rename: 'ticket:rename',
    renameModal: 'ticket:modal:rename',
    transcript: 'ticket:transcript',
};
const transcriptMessageLimit = 5000;

function getDashboardPublicUrl(config = getConfig()) {
    return (process.env.DASHBOARD_PUBLIC_URL || config.dashboard?.publicUrl || '').replace(/\/$/, '');
}

function getTicketConfig(config = getConfig()) {
    return {
        channelId: config.tickets?.channelId || config.ticketChannelId,
        messageId: config.tickets?.messageId || config.ticketMessageID,
        categoryId: config.tickets?.categoryId || config.ticketCategoryId,
        supportRoleId: config.tickets?.supportRoleId || config.ticketRole,
        allowTranscripts: config.tickets?.allowTranscripts !== false,
        allowUserAdding: config.tickets?.allowUserAdding !== false,
        allowClaiming: config.tickets?.allowClaiming !== false,
        closeInactivityDays: Number(config.tickets?.closeInactivityDays ?? config.tickets?.autoCloseDays ?? 0),
        autoCloseDays: Number(config.tickets?.autoCloseDays ?? config.tickets?.closeInactivityDays ?? 0),
    };
}

async function getGuildTicketConfig(guildId) {
    return getTicketConfig(await getGuildSettings(guildId));
}

function createTicketControls(state = 'open') {
    if (state === 'open') {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(customIds.claim),
                new ButtonBuilder()
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(customIds.transcript),
                new ButtonBuilder()
                    .setLabel('Rename')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId(customIds.rename),
                new ButtonBuilder()
                    .setLabel(language.tickets.closeButton)
                    .setStyle(ButtonStyle.Danger)
                    .setCustomId(customIds.close),
            ),
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(customIds.addUser)
                    .setPlaceholder('Add user')
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(customIds.removeUser)
                    .setPlaceholder('Remove user')
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
        ];
    }

    if (state === 'closed') {
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Transcript')
                .setStyle(ButtonStyle.Secondary)
                .setCustomId(customIds.transcript),
            new ButtonBuilder()
                .setLabel(language.tickets.deleteButton)
                .setStyle(ButtonStyle.Danger)
                .setCustomId(customIds.delete),
        )];
    }

    return [];
}

function createPanelControls() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(language.tickets.openButton)
            .setStyle(ButtonStyle.Primary)
            .setCustomId(customIds.open),
    )];
}

function createSafeTicketName(user) {
    const safeName = user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70);

    return `ticket-${safeName || user.id}`;
}

function formatTicketRelative(timestamp) {
    return timestamp ? `<t:${Math.floor(Number(timestamp) / 1000)}:R>` : 'Unknown';
}

function createTicketHeaderEmbed(record = {}, options = {}) {
    const status = record.status || options.status || 'open';
    const fields = [
        { name: 'Ticket #', value: record.channelId ? `<#${record.channelId}>` : options.channelName || 'Pending', inline: true },
        { name: 'Opened by', value: record.openerId ? `<@${record.openerId}>` : 'Unknown', inline: true },
        { name: 'Claimed by', value: record.claimedById ? `<@${record.claimedById}>` : 'Unclaimed', inline: true },
        { name: 'Status', value: status, inline: true },
        { name: 'Priority', value: record.priority || 'normal', inline: true },
        { name: 'Created', value: formatTicketRelative(record.createdAt), inline: true },
        record.tags?.length ? { name: 'Tags', value: record.tags.join(', ') } : null,
        record.closeReason ? { name: 'Close reason', value: record.closeReason } : null,
    ].filter(Boolean);

    return createEmbed({
        title: options.title || `Ticket ${status}`,
        description: options.description || 'Ticket metadata and controls are persisted for restart-safe management.',
        color: options.color || (status === 'closed' ? 'red' : 'green'),
        fields,
    });
}

function createCloseTicketModal() {
    return new ModalBuilder()
        .setCustomId(customIds.closeModal)
        .setTitle('Close Ticket')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Reason')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500),
        ));
}

function createRenameTicketModal() {
    return new ModalBuilder()
        .setCustomId(customIds.renameModal)
        .setTitle('Rename Ticket')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('name')
                .setLabel('Ticket name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(80),
        ));
}

function userCanManageTicket(interaction, ticketConfig) {
    const member = interaction.member;
    return Boolean(
        member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)
        || (ticketConfig.supportRoleId && member?.roles?.cache?.has(ticketConfig.supportRoleId))
        || interaction.channel?.topic === interaction.user.id
    );
}

async function createTicketPanel(interaction, ticketChannel, ticketRole, ticketCategory) {
    if (!isGuildTextChannel(ticketChannel)) {
        return interaction.reply({ content: language.tickets.channelMustBeText, flags: 64 });
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    const panelPermissions = ticketChannel.permissionsFor(botMember);
    if (!panelPermissions?.has(PermissionsBitField.Flags.ViewChannel) || !panelPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
        return interaction.reply({ content: 'I need View Channel and Send Messages in the ticket panel channel.', flags: 64 });
    }

    if (!botMember?.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ content: 'I need Manage Channels to create ticket channels.', flags: 64 });
    }

    if (!ticketCategory || ticketCategory.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: 'Please choose a category for new ticket channels.', flags: 64 });
    }

    if (!ticketRole || ticketRole.id === interaction.guild.id) {
        return interaction.reply({ content: 'Please choose a normal support role for tickets.', flags: 64 });
    }

    const ticketEmbed = createEmbed({
        title: language.tickets.panelTitle,
        description: language.tickets.panelDescription,
        color: 'red',
    });

    const message = await ticketChannel.send({
        embeds: [ticketEmbed],
        components: createPanelControls(),
    });

    await updateTicketSettings(interaction.guild.id, {
        channelId: ticketChannel.id,
        messageId: message.id,
        categoryId: ticketCategory.id,
        supportRoleId: ticketRole.id,
    }, {
        actorId: interaction.user.id,
        source: 'command',
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket panel configured',
        color: 'green',
        user: interaction.user,
        fields: [
            { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true },
            { name: 'Category', value: ticketCategory.name, inline: true },
            { name: 'Support role', value: `<@&${ticketRole.id}>`, inline: true },
            { name: 'Configured by', value: formatUser(interaction.user) },
        ],
    }).catch(() => null);

    return interaction.reply({
        content: formatTemplate(language.tickets.setupComplete, { channel: `<#${ticketChannel.id}>` }),
        flags: 64,
    });
}

async function openTicket(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    if (!ticketConfig.categoryId || !ticketConfig.supportRoleId) {
        return interaction.reply({ content: language.tickets.missingSetup, flags: 64 });
    }

    const existingTicket = interaction.guild.channels.cache.find(channel =>
        channel.parentId === ticketConfig.categoryId
        && channel.topic === interaction.user.id
        && channel.name.startsWith('ticket-'));

    if (existingTicket) {
        return interaction.reply({
            content: formatTemplate(language.tickets.alreadyOpen, { channel: `<#${existingTicket.id}>` }),
            flags: 64,
        });
    }

    const newChannel = await interaction.guild.channels.create({
        name: createSafeTicketName(interaction.user),
        type: ChannelType.GuildText,
        parent: ticketConfig.categoryId,
        topic: interaction.user.id,
        permissionOverwrites: [
            {
                id: interaction.user.id,
                allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            },
            {
                id: interaction.guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
                id: ticketConfig.supportRoleId,
                allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            },
        ],
    });

    const record = await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: newChannel.id,
        openerId: interaction.user.id,
        openerTag: interaction.user.tag,
        status: 'open',
        priority: 'normal',
        tags: [],
        lastActivityAt: Date.now(),
    });

    await newChannel.send({
        content: `<@${interaction.user.id}> <@&${ticketConfig.supportRoleId}>`,
        embeds: [createTicketHeaderEmbed(record, {
            title: language.tickets.createdTitle,
            description: language.tickets.createdDescription,
            color: 'green',
        })],
        components: createTicketControls('open'),
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket opened',
        color: 'green',
        user: interaction.user,
        fields: [
            { name: 'Ticket', value: `<#${newChannel.id}>`, inline: true },
            { name: 'Opened by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `Ticket created: <#${newChannel.id}>`, flags: 64 });
}

async function fetchTranscriptMessages(channel) {
    const collected = [];
    let before;

    while (collected.length < transcriptMessageLimit) {
        const remaining = transcriptMessageLimit - collected.length;
        const batch = await channel.messages.fetch({
            limit: Math.min(100, remaining),
            ...(before ? { before } : {}),
        }).catch(() => null);

        if (!batch?.size) break;

        collected.push(...batch.values());
        before = batch.last()?.id;
        if (batch.size < 100) break;
    }

    return collected;
}

function formatTranscriptLine(message) {
    const timestamp = message.createdAt.toISOString();
    const content = message.content || '[No text content]';
    const attachments = message.attachments?.size
        ? ` Attachments: ${[...message.attachments.values()].map(attachment => attachment.url).join(', ')}`
        : '';
    const embeds = message.embeds?.length ? ` Embeds: ${message.embeds.length}` : '';

    return `[${timestamp}] ${message.author?.tag || 'Unknown'} (${message.author?.id || 'unknown'}): ${content}${attachments}${embeds}`;
}

function renderTranscriptMessage(message) {
    const authorName = message.author?.tag || message.author?.username || 'Unknown';
    const avatar = message.author?.displayAvatarURL?.({ extension: 'png', size: 64 }) || '';
    const content = message.content ? escapeHtml(message.content).replace(/\n/g, '<br>') : '<span class="muted">No text content</span>';
    const attachments = message.attachments?.size
        ? `<div class="attachments">${[...message.attachments.values()].map(attachment => `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">${escapeHtml(attachment.name || attachment.url)}</a>`).join('')}</div>`
        : '';
    const embeds = message.embeds?.length
        ? `<div class="embed-note">${message.embeds.length} embed${message.embeds.length === 1 ? '' : 's'}</div>`
        : '';

    return `
<article class="message">
    <img class="avatar" src="${escapeHtml(avatar)}" alt="">
    <div class="message-body">
        <div class="message-meta"><strong>${escapeHtml(authorName)}</strong><span>${escapeHtml(message.createdAt.toLocaleString())}</span></div>
        <div class="message-content">${content}</div>
        ${attachments}
        ${embeds}
    </div>
</article>`;
}

function renderTranscriptHtml(channel, messages) {
    const renderedMessages = messages.map(renderTranscriptMessage).join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(channel.name)} transcript</title>
<style>
body{margin:0;background:#313338;color:#dbdee1;font-family:Inter,Arial,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:24px}
.header{position:sticky;top:0;background:#2b2d31;border-bottom:1px solid #1f2023;padding:16px 24px;z-index:2}
.header h1{font-size:20px;margin:0}.header p{margin:6px 0 0;color:#b5bac1}
.message{display:grid;grid-template-columns:42px 1fr;gap:12px;padding:10px 0}
.avatar{width:42px;height:42px;border-radius:50%;background:#1e1f22}
.message-meta{display:flex;gap:8px;align-items:baseline}.message-meta span{color:#949ba4;font-size:12px}
.message-content{margin-top:3px;line-height:1.45;white-space:normal;overflow-wrap:anywhere}
.attachments{display:grid;gap:4px;margin-top:8px}.attachments a{color:#00a8fc}
.embed-note{margin-top:8px;border-left:4px solid #5865f2;background:#2b2d31;padding:8px;border-radius:4px;color:#b5bac1}
.muted{color:#949ba4}
</style>
</head>
<body>
<div class="header"><h1>#${escapeHtml(channel.name)}</h1><p>${messages.length} message${messages.length === 1 ? '' : 's'} exported</p></div>
<main class="wrap">${renderedMessages || '<p class="muted">No messages found.</p>'}</main>
</body>
</html>`;
}

async function buildTranscript(channel) {
    const messages = await fetchTranscriptMessages(channel);
    if (!messages.length) return null;

    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = sortedMessages.map(formatTranscriptLine);

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `${channel.name}-transcript.txt`,
    });
}

async function createDashboardTranscript(channel, createdBy) {
    const messages = await fetchTranscriptMessages(channel);
    if (!messages.length) return null;

    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const text = sortedMessages.map(formatTranscriptLine).join('\n');
    const html = renderTranscriptHtml(channel, sortedMessages);
    const authorIds = sortedMessages.map(message => message.author?.id).filter(Boolean);
    const openerId = channel.topic || null;

    return createTicketTranscript({
        guildId: channel.guild.id,
        channelId: channel.id,
        channelName: channel.name,
        ticketName: channel.name,
        openerId,
        createdBy: createdBy?.id || null,
        messageCount: sortedMessages.length,
        allowedUserIds: [openerId, createdBy?.id, ...authorIds],
        html,
        text,
    });
}

function getTranscriptUrl(transcript) {
    const publicUrl = getDashboardPublicUrl();
    return publicUrl ? `${publicUrl}/transcripts/${encodeURIComponent(transcript.id)}` : `/transcripts/${encodeURIComponent(transcript.id)}`;
}

async function sendTicketTranscript(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const transcript = await createDashboardTranscript(channel, interaction.user);
    if (!transcript) {
        return interaction.reply({ content: 'No messages were found to transcript.', flags: 64 });
    }

    return interaction.reply({ content: `Ticket transcript generated: ${getTranscriptUrl(transcript)}`, flags: 64 });
}

async function addTicketUser(interaction, user) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    await channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'User added to ticket',
        color: 'green',
        user,
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'User', value: formatUser(user), inline: true },
            { name: 'Added by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `<@${user.id}> has been added to this ticket.`, flags: 64 });
}

async function claimTicket(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const record = await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: channel.id,
        claimedById: interaction.user.id,
        claimedByTag: interaction.user.tag,
        lastActivityAt: Date.now(),
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket claimed',
        color: 'blue',
        user: interaction.user,
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'Claimed by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `Ticket claimed by <@${record.claimedById}>.`, flags: 64 });
}

async function unclaimTicket(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: channel.id,
        claimedById: null,
        claimedByTag: null,
        lastActivityAt: Date.now(),
    });

    return interaction.reply({ content: 'Ticket claim cleared.', flags: 64 });
}

async function setTicketPriority(interaction, priority) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: channel.id,
        priority,
        lastActivityAt: Date.now(),
    });

    return interaction.reply({ content: `Ticket priority set to ${priority}.`, flags: 64 });
}

async function setTicketTags(interaction, tags) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const parsedTags = tags
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);

    await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: channel.id,
        tags: parsedTags,
        lastActivityAt: Date.now(),
    });

    return interaction.reply({ content: parsedTags.length ? `Ticket tags set: ${parsedTags.join(', ')}` : 'Ticket tags cleared.', flags: 64 });
}

async function showTicketStatus(interaction) {
    const channel = interaction.channel;
    const record = await getTicketRecord(channel.id);

    if (!record) return interaction.reply({ content: 'No ticket metadata was found for this channel.', flags: 64 });

    return interaction.reply({
        embeds: [createTicketHeaderEmbed(record, { title: 'Ticket Status', color: 'blue' })],
        flags: 64,
    });
}

async function listTickets(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const records = await listTicketRecords(interaction.guild.id, 20);
    const lines = records.map(record => [
        `<#${record.channelId}>`,
        record.status,
        record.priority,
        record.claimedById ? `claimed by <@${record.claimedById}>` : 'unclaimed',
        record.createdAt ? `opened <t:${Math.floor(record.createdAt / 1000)}:R>` : '',
        record.tags?.length ? `[${record.tags.join(', ')}]` : '',
    ].filter(Boolean).join(' - '));

    return interaction.reply({ content: lines.length ? lines.join('\n') : 'No ticket metadata was found.', flags: 64 });
}

async function touchTicketActivity(message) {
    if (!message.guild || !message.channel?.name?.startsWith('ticket-')) return;

    await upsertTicketRecord({
        guildId: message.guild.id,
        channelId: message.channel.id,
        lastActivityAt: Date.now(),
    });
}

async function removeTicketUser(interaction, user) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    await channel.permissionOverwrites.delete(user.id).catch(async () => {
        await channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'User removed from ticket',
        color: 'orange',
        user,
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'User', value: formatUser(user), inline: true },
            { name: 'Removed by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `<@${user.id}> has been removed from this ticket.`, flags: 64 });
}

async function renameTicket(interaction, name) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const prefix = channel.name.startsWith('closed-') ? 'closed-' : 'ticket-';
    const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    if (!safeName) {
        return interaction.reply({ content: 'Please provide a valid ticket name.', flags: 64 });
    }

    const oldName = channel.name;
    await channel.setName(`${prefix}${safeName}`);

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket renamed',
        color: 'blue',
        user: interaction.user,
        fields: [
            { name: 'Old name', value: oldName, inline: true },
            { name: 'New name', value: channel.name, inline: true },
            { name: 'Renamed by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `Ticket renamed to ${channel.name}.`, flags: 64 });
}

async function closeTicket(interaction, options = {}) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const ticketUserId = channel.topic;
    const overwrites = [
        {
            id: interaction.guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel],
        },
    ];

    if (ticketUserId) {
        overwrites.push({
            id: ticketUserId,
            deny: [PermissionsBitField.Flags.ViewChannel],
        });
    }

    if (ticketConfig.supportRoleId) {
        overwrites.push({
            id: ticketConfig.supportRoleId,
            allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
        });
    }

    await channel.permissionOverwrites.set(overwrites);
    await channel.setName(channel.name.replace('ticket-', 'closed-'));
    const closedAt = Date.now();
    const closeReason = options.reason?.trim() || null;
    const record = await upsertTicketRecord({
        guildId: interaction.guild.id,
        channelId: channel.id,
        status: 'closed',
        closeReason,
        closedAt,
        lastActivityAt: closedAt,
    });

    const closedEmbed = createTicketHeaderEmbed(record, {
        title: language.tickets.closedTitle,
        description: `${language.tickets.closedDescription}\n\nClosed by <@${interaction.user.id}>.`,
        color: 'red',
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket closed',
        color: 'orange',
        user: interaction.user,
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'Closed by', value: formatUser(interaction.user), inline: true },
            { name: 'Opened by', value: ticketUserId ? `<@${ticketUserId}> (${ticketUserId})` : 'Unknown' },
            closeReason ? { name: 'Reason', value: closeReason } : null,
        ].filter(Boolean),
    }).catch(() => null);

    return interaction.reply({ embeds: [closedEmbed], components: createTicketControls('closed') });
}

async function handleTicketButton(interaction) {
    if (!interaction.isButton?.() || !interaction.guild) return false;

    if (interaction.customId === customIds.open || interaction.customId === 'open_ticket') {
        await openTicket(interaction);
        return true;
    }

    if (interaction.customId === customIds.close || interaction.customId === 'close_ticket') {
        await interaction.showModal(createCloseTicketModal());
        return true;
    }

    if (interaction.customId === customIds.delete || interaction.customId === 'delete_ticket') {
        await deleteTicket(interaction);
        return true;
    }

    if (interaction.customId === customIds.claim) {
        await claimTicket(interaction);
        return true;
    }

    if (interaction.customId === customIds.rename) {
        await interaction.showModal(createRenameTicketModal());
        return true;
    }

    if (interaction.customId === customIds.transcript) {
        await sendTicketTranscript(interaction);
        return true;
    }

    return false;
}

async function resolveSelectedUser(interaction) {
    const userId = interaction.values?.[0];
    return interaction.users?.get?.(userId)
        || await interaction.client?.users?.fetch?.(userId).catch(() => null)
        || await interaction.guild?.members?.fetch?.(userId).then(member => member.user).catch(() => null)
        || (userId ? { id: userId, tag: userId } : null);
}

async function handleTicketUserSelect(interaction) {
    if (!interaction.isUserSelectMenu?.() || !interaction.guild) return false;
    if (interaction.customId !== customIds.addUser && interaction.customId !== customIds.removeUser) return false;

    const user = await resolveSelectedUser(interaction);
    if (!user) {
        await interaction.reply({ content: 'That user could not be resolved.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === customIds.addUser) {
        await addTicketUser(interaction, user);
        return true;
    }

    await removeTicketUser(interaction, user);
    return true;
}

async function handleTicketModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.guild) return false;

    if (interaction.customId === customIds.closeModal) {
        const reason = interaction.fields.getTextInputValue('reason').trim();
        await closeTicket(interaction, { reason });
        return true;
    }

    if (interaction.customId === customIds.renameModal) {
        const name = interaction.fields.getTextInputValue('name').trim();
        await renameTicket(interaction, name);
        return true;
    }

    return false;
}

async function deleteTicket(interaction) {
    const ticketConfig = await getGuildTicketConfig(interaction.guild.id);
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notClosedTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const transcript = await createDashboardTranscript(channel, interaction.user);
    const transcriptUrl = transcript ? getTranscriptUrl(transcript) : null;
    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket deleted',
        color: 'red',
        user: interaction.user,
        fields: [
            { name: 'Ticket', value: channel.name, inline: true },
            { name: 'Deleted by', value: formatUser(interaction.user), inline: true },
            ...(transcriptUrl ? [{ name: 'Transcript', value: transcriptUrl }] : []),
        ],
    }).catch(() => null);

    await interaction.reply({ content: language.tickets.deleting, flags: 64 });
    await deleteTicketRecord(channel.id);
    return channel.delete();
}

async function autoCloseInactiveTickets(client) {
    let closed = 0;
    for (const guild of client.guilds.cache.values()) {
        const ticketConfig = await getGuildTicketConfig(guild.id);
        const days = Number(ticketConfig.autoCloseDays || ticketConfig.closeInactivityDays || 0);
        if (!days) continue;

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const records = await listTicketRecords(guild.id, 500);

        for (const record of records.filter(item => item.status === 'open' && Number(item.lastActivityAt || item.createdAt || 0) <= cutoff)) {
            const channel = await guild.channels.fetch(record.channelId).catch(() => null);
            if (!channel?.name?.startsWith('ticket-')) continue;

            const overwrites = [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
            ];

            if (record.openerId) {
                overwrites.push({ id: record.openerId, deny: [PermissionsBitField.Flags.ViewChannel] });
            }

            if (ticketConfig.supportRoleId) {
                overwrites.push({
                    id: ticketConfig.supportRoleId,
                    allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
                });
            }

            await channel.permissionOverwrites.set(overwrites).catch(() => null);
            await channel.setName(channel.name.replace('ticket-', 'closed-')).catch(() => null);
            await upsertTicketRecord({ ...record, status: 'closed', lastActivityAt: Date.now() });
            await channel.send(`Ticket auto-closed after ${days} day(s) of inactivity.`).catch(() => null);
            closed += 1;
        }
    }

    return { closed };
}

function startTicketScheduler(client) {
    const run = () => autoCloseInactiveTickets(client).catch(error => console.error('Ticket scheduler failed:', error));
    run();
    return setInterval(run, 60 * 60 * 1000);
}

module.exports = {
    addTicketUser,
    autoCloseInactiveTickets,
    buildTranscript,
    createDashboardTranscript,
    claimTicket,
    closeTicket,
    createCloseTicketModal,
    createRenameTicketModal,
    createTicketHeaderEmbed,
    createTicketPanel,
    createTicketControls,
    customIds,
    deleteTicket,
    fetchTranscriptMessages,
    formatTranscriptLine,
    getGuildTicketConfig,
    getTicketConfig,
    handleTicketButton,
    handleTicketModal,
    handleTicketUserSelect,
    listTickets,
    openTicket,
    removeTicketUser,
    renameTicket,
    sendTicketTranscript,
    setTicketPriority,
    setTicketTags,
    showTicketStatus,
    startTicketScheduler,
    touchTicketActivity,
    unclaimTicket,
};
