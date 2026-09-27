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
        return interaction.reply({ content: language.tickets.channelMustBeText, ephemeral: true });
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
        ephemeral: true,
    });
}

async function openTicket(interaction) {
    const ticketConfig = getTicketConfig();
    if (!ticketConfig.categoryId || !ticketConfig.supportRoleId) {
        return interaction.reply({ content: language.tickets.missingSetup, ephemeral: true });
    }

    const existingTicket = interaction.guild.channels.cache.find(channel =>
        channel.parentId === ticketConfig.categoryId
        && channel.topic === interaction.user.id
        && channel.name.startsWith('ticket-'));

    if (existingTicket) {
        return interaction.reply({
            content: formatTemplate(language.tickets.alreadyOpen, { channel: `<#${existingTicket.id}>` }),
            ephemeral: true,
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

    return interaction.reply({ content: `Ticket created: <#${newChannel.id}>`, ephemeral: true });
}

async function buildTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) return null;

    const lines = [...messages.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(message => {
            const timestamp = message.createdAt.toISOString();
            const content = message.content || '[Embed/attachment/no text]';
            return `[${timestamp}] ${message.author?.tag || 'Unknown'}: ${content}`;
        });

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `${channel.name}-transcript.txt`,
    });
}

async function sendTicketTranscript(interaction) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
    }

    const transcript = await buildTranscript(channel);
    if (!transcript) {
        return interaction.reply({ content: 'No messages were found to transcript.', ephemeral: true });
    }

    return interaction.reply({ content: 'Ticket transcript generated.', files: [transcript], ephemeral: true });
}

async function addTicketUser(interaction, user) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
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

    return interaction.reply({ content: `<@${user.id}> has been added to this ticket.`, ephemeral: true });
}

async function removeTicketUser(interaction, user) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
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

    return interaction.reply({ content: `<@${user.id}> has been removed from this ticket.`, ephemeral: true });
}

async function renameTicket(interaction, name) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-') && !channel?.name?.startsWith('closed-')) {
        return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
    }

    const prefix = channel.name.startsWith('closed-') ? 'closed-' : 'ticket-';
    const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    if (!safeName) {
        return interaction.reply({ content: 'Please provide a valid ticket name.', ephemeral: true });
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

    return interaction.reply({ content: `Ticket renamed to ${channel.name}.`, ephemeral: true });
}

async function closeTicket(interaction) {
    const ticketConfig = getTicketConfig();
    const channel = interaction.channel;

    if (!channel?.name?.startsWith('ticket-')) {
        return interaction.reply({ content: language.tickets.notTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
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
        return interaction.reply({ content: language.tickets.notClosedTicket, ephemeral: true });
    }

    if (!userCanManageTicket(interaction, ticketConfig)) {
        return interaction.reply({ content: language.tickets.noPermission, ephemeral: true });
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

    await interaction.reply({ content: language.tickets.deleting, ephemeral: true });
    return channel.delete();
}

module.exports = {
    addTicketUser,
    closeTicket,
    createTicketPanel,
    customIds,
    deleteTicket,
    getTicketConfig,
    openTicket,
    removeTicketUser,
    renameTicket,
    sendTicketTranscript,
};
