const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const language = require('./language');
const { createEmbed } = require('./embeds');
const { getConfig, updateConfig } = require('./config');
const { formatTemplate } = require('./template');
const { isGuildTextChannel } = require('./discord');
const { sendLog, formatUser } = require('./logging');

const customIds = {
    open: 'ticket:open',
    close: 'ticket:close',
    delete: 'ticket:delete',
};
const transcriptMessageLimit = 5000;

function getTicketConfig(config = getConfig()) {
    return {
        channelId: config.tickets?.channelId || config.ticketChannelId,
        messageId: config.tickets?.messageId || config.ticketMessageID,
        categoryId: config.tickets?.categoryId || config.ticketCategoryId,
        supportRoleId: config.tickets?.supportRoleId || config.ticketRole,
    };
}

function createTicketControls(state = 'open') {
    const buttons = [];

    if (state === 'open') {
        buttons.push(new ButtonBuilder()
            .setLabel(language.tickets.closeButton)
            .setStyle(ButtonStyle.Primary)
            .setCustomId(customIds.close));
    }

    if (state === 'closed') {
        buttons.push(new ButtonBuilder()
            .setLabel(language.tickets.deleteButton)
            .setStyle(ButtonStyle.Danger)
            .setCustomId(customIds.delete));
    }

    return [new ActionRowBuilder().addComponents(...buttons)];
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

    updateConfig(config => {
        config.tickets = {
            channelId: ticketChannel.id,
            messageId: message.id,
            categoryId: ticketCategory.id,
            supportRoleId: ticketRole.id,
        };

        delete config.ticketMessageID;
        delete config.ticketChannelId;
        delete config.ticketCategoryId;
        delete config.ticketRole;
        return config;
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket panel configured',
        color: 'green',
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
    const ticketConfig = getTicketConfig();
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

    const ticketEmbed = createEmbed({
        title: language.tickets.createdTitle,
        description: language.tickets.createdDescription,
        color: 'green',
        fields: [
            { name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Support role', value: `<@&${ticketConfig.supportRoleId}>`, inline: true },
        ],
    });

    await newChannel.send({
        content: `<@${interaction.user.id}> <@&${ticketConfig.supportRoleId}>`,
        embeds: [ticketEmbed],
        components: createTicketControls('open'),
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket opened',
        color: 'green',
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

async function buildTranscript(channel) {
    const messages = await fetchTranscriptMessages(channel);
    if (!messages.length) return null;

    const lines = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(formatTranscriptLine);

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `${channel.name}-transcript.txt`,
    });
}

async function sendTicketTranscript(interaction) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const transcript = await buildTranscript(channel);
    if (!transcript) {
        return interaction.reply({ content: 'No messages were found to transcript.', flags: 64 });
    }

    return interaction.reply({ content: 'Ticket transcript generated.', files: [transcript], flags: 64 });
}

async function addTicketUser(interaction, user) {
    const ticketConfig = getTicketConfig();
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
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'User', value: formatUser(user), inline: true },
            { name: 'Added by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `<@${user.id}> has been added to this ticket.`, flags: 64 });
}

async function removeTicketUser(interaction, user) {
    const ticketConfig = getTicketConfig();
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
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'User', value: formatUser(user), inline: true },
            { name: 'Removed by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `<@${user.id}> has been removed from this ticket.`, flags: 64 });
}

async function renameTicket(interaction, name) {
    const ticketConfig = getTicketConfig();
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
        fields: [
            { name: 'Old name', value: oldName, inline: true },
            { name: 'New name', value: channel.name, inline: true },
            { name: 'Renamed by', value: formatUser(interaction.user), inline: true },
        ],
    }).catch(() => null);

    return interaction.reply({ content: `Ticket renamed to ${channel.name}.`, flags: 64 });
}

async function closeTicket(interaction) {
    const ticketConfig = getTicketConfig();
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

    const closedEmbed = createEmbed({
        title: language.tickets.closedTitle,
        description: language.tickets.closedDescription,
        color: 'red',
        fields: [{ name: 'Closed by', value: `<@${interaction.user.id}>` }],
    });

    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket closed',
        color: 'orange',
        fields: [
            { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
            { name: 'Closed by', value: formatUser(interaction.user), inline: true },
            { name: 'Opened by', value: ticketUserId ? `<@${ticketUserId}> (${ticketUserId})` : 'Unknown' },
        ],
    }).catch(() => null);

    return interaction.reply({ embeds: [closedEmbed], components: createTicketControls('closed') });
}

async function deleteTicket(interaction) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notClosedTicket, flags: 64 });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, flags: 64 });
    }

    const transcript = await buildTranscript(channel);
    await sendLog(interaction.guild, {
        type: 'ticket',
        title: 'Ticket deleted',
        color: 'red',
        fields: [
            { name: 'Ticket', value: channel.name, inline: true },
            { name: 'Deleted by', value: formatUser(interaction.user), inline: true },
        ],
        files: transcript ? [transcript] : [],
    }).catch(() => null);

    await interaction.reply({ content: language.tickets.deleting, flags: 64 });
    return channel.delete();
}

module.exports = {
    addTicketUser,
    buildTranscript,
    closeTicket,
    createTicketPanel,
    customIds,
    deleteTicket,
    fetchTranscriptMessages,
    formatTranscriptLine,
    getTicketConfig,
    openTicket,
    removeTicketUser,
    renameTicket,
    sendTicketTranscript,
};
