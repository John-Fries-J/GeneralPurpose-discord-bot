const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');
const { getConfig } = require('./config');
const { createEmbed } = require('./embeds');
const { deleteTemporaryVoiceChannel, getOwnedVoiceChannel, transferOwnership } = require('./joinToCreate');
const { getTempVoiceChannel, upsertTempVoiceChannel } = require('./store');

const voicePanelCustomIds = {
    claim: 'voice:panel:claim',
    rename: 'voice:panel:rename',
    limit: 'voice:panel:limit',
    lock: 'voice:panel:lock',
    unlock: 'voice:panel:unlock',
    delete: 'voice:panel:delete',
    transfer: 'voice:panel:transfer',
    permit: 'voice:panel:permit',
    reject: 'voice:panel:reject',
    renameModal: 'voice:modal:rename',
    limitModal: 'voice:modal:limit',
};

function getHumanMembers(channel) {
    return [...(channel?.members?.values?.() || [])]
        .filter(member => !member.user?.bot);
}

function formatMemberList(channel) {
    const members = getHumanMembers(channel);
    if (!members.length) return 'No human members';

    const shown = members.slice(0, 8).map(member => `<@${member.id}>`).join(', ');
    return members.length > 8 ? `${shown}, +${members.length - 8} more` : shown;
}

function createVoicePanelEmbed(channel, record) {
    if (!channel || !record) {
        return createEmbed({
            title: 'Temporary Voice Controls',
            description: 'Join one of your temporary voice channels to manage it here.',
            color: 'blue',
            fields: [
                { name: 'Ownership', value: 'Claim an abandoned channel or transfer ownership to another member.' },
                { name: 'Access', value: 'Rename, limit, lock, permit, reject, or delete your channel.' },
            ],
        });
    }

    const memberCount = getHumanMembers(channel).length;
    const userLimit = channel.userLimit || record.userLimit || 0;

    return createEmbed({
        title: 'Temporary Voice Controls',
        description: 'Manage your current temporary voice channel.',
        color: record.locked ? 'orange' : 'blue',
        fields: [
            { name: 'Channel', value: `<#${channel.id}>\n${channel.name || record.name || 'Unnamed'}`, inline: true },
            { name: 'Owner', value: `<@${record.ownerId}>`, inline: true },
            { name: 'Access', value: record.locked ? 'Locked' : 'Public', inline: true },
            { name: 'Users', value: `${memberCount}${userLimit ? ` / ${userLimit}` : ''}\n${formatMemberList(channel)}` },
            { name: 'User limit', value: userLimit ? `${userLimit}` : 'Unlimited', inline: true },
            { name: 'Created', value: record.createdAt ? `<t:${Math.floor(record.createdAt / 1000)}:R>` : 'Unknown', inline: true },
        ],
    });
}

async function createVoicePanelPayload(interaction = null) {
    const channel = interaction?.member?.voice?.channel || null;
    const record = channel ? await getTempVoiceChannel(channel.id).catch(() => null) : null;
    const embed = createVoicePanelEmbed(channel, record);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(voicePanelCustomIds.claim).setLabel('Claim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(voicePanelCustomIds.rename).setLabel('Rename').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(voicePanelCustomIds.limit).setLabel('Limit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(voicePanelCustomIds.lock).setLabel('Lock').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(voicePanelCustomIds.unlock).setLabel('Unlock').setStyle(ButtonStyle.Secondary),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(voicePanelCustomIds.delete).setLabel('Delete').setStyle(ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(voicePanelCustomIds.transfer)
                    .setPlaceholder('Transfer ownership')
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(voicePanelCustomIds.permit)
                    .setPlaceholder('Permit a user')
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(voicePanelCustomIds.reject)
                    .setPlaceholder('Reject a user')
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    };
}

function createRenameModal() {
    return new ModalBuilder()
        .setCustomId(voicePanelCustomIds.renameModal)
        .setTitle('Rename Voice Channel')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('name')
                .setLabel('Channel name')
                .setStyle(TextInputStyle.Short)
                .setMinLength(2)
                .setMaxLength(100)
                .setRequired(true),
        ));
}

function createLimitModal(max = 25) {
    return new ModalBuilder()
        .setCustomId(voicePanelCustomIds.limitModal)
        .setTitle('Set Voice Limit')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('limit')
                .setLabel(`User limit, 0-${max}`)
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(2)
                .setRequired(true),
        ));
}

async function claimVoiceChannel(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) return interaction.reply({ content: 'Join the temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const record = await getTempVoiceChannel(channel.id);
    if (!record) return interaction.reply({ content: 'This is not a temporary join-to-create channel.', flags: MessageFlags.Ephemeral });
    if (record.ownerId === interaction.user.id) return interaction.reply({ content: 'You already own this channel.', flags: MessageFlags.Ephemeral });
    if (channel.members.has(record.ownerId)) return interaction.reply({ content: 'The current owner is still in the channel.', flags: MessageFlags.Ephemeral });

    const updated = await transferOwnership(record, channel, interaction.member);
    return interaction.reply({ content: `You now own <#${updated.channelId}>.`, flags: MessageFlags.Ephemeral });
}

async function handleVoicePanelButton(interaction) {
    if (!interaction.isButton?.() || !interaction.customId.startsWith('voice:panel:')) return false;

    if (interaction.customId === voicePanelCustomIds.claim) {
        await claimVoiceChannel(interaction);
        return true;
    }

    const owned = await getOwnedVoiceChannel(interaction);
    if (!owned.ok) {
        await interaction.reply({ content: owned.message, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.rename) {
        await interaction.showModal(createRenameModal());
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.limit) {
        await interaction.showModal(createLimitModal(Number(getConfig().joinToCreate?.userLimitMax || 25)));
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.lock) {
        await owned.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
        await upsertTempVoiceChannel({ ...owned.record, locked: true, name: owned.channel.name, userLimit: owned.channel.userLimit || 0 });
        await interaction.reply({ content: 'Voice channel locked.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.unlock) {
        await owned.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
        await upsertTempVoiceChannel({ ...owned.record, locked: false, name: owned.channel.name, userLimit: owned.channel.userLimit || 0 });
        await interaction.reply({ content: 'Voice channel unlocked.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.delete) {
        await interaction.reply({ content: 'Deleting your temporary voice channel.', flags: MessageFlags.Ephemeral });
        await deleteTemporaryVoiceChannel(interaction.guild, owned.channel.id, 'Voice owner deleted temporary channel from panel', { force: true });
        return true;
    }

    return false;
}

async function handleVoicePanelModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.customId.startsWith('voice:modal:')) return false;

    const owned = await getOwnedVoiceChannel(interaction);
    if (!owned.ok) {
        await interaction.reply({ content: owned.message, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.renameModal) {
        const name = interaction.fields.getTextInputValue('name').trim();
        await owned.channel.setName(name, 'Voice owner renamed channel from panel');
        await upsertTempVoiceChannel({ ...owned.record, name });
        await interaction.reply({ content: `Voice channel renamed to ${name}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.limitModal) {
        const rawLimit = interaction.fields.getTextInputValue('limit').trim();
        const amount = Number(rawLimit);
        const max = Number(getConfig().joinToCreate?.userLimitMax || 25);
        if (!Number.isInteger(amount) || amount < 0 || amount > max) {
            await interaction.reply({ content: `Enter a whole number from 0 to ${max}.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        await owned.channel.setUserLimit(amount, 'Voice owner changed user limit from panel');
        await upsertTempVoiceChannel({ ...owned.record, userLimit: amount, name: owned.channel.name });
        await interaction.reply({ content: `Voice channel limit set to ${amount || 'unlimited'}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handleVoicePanelUserSelect(interaction) {
    if (!interaction.isUserSelectMenu?.() || !interaction.customId.startsWith('voice:panel:')) return false;

    const owned = await getOwnedVoiceChannel(interaction);
    if (!owned.ok) {
        await interaction.reply({ content: owned.message, flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = interaction.values[0];
    const member = owned.channel.members.get(userId) || await interaction.guild.members.fetch(userId).catch(() => null);

    if (interaction.customId === voicePanelCustomIds.transfer) {
        if (!member || member.voice?.channelId !== owned.channel.id || member.user.bot) {
            await interaction.reply({ content: 'Choose a human member currently in your voice channel.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await transferOwnership(owned.record, owned.channel, member);
        await interaction.reply({ content: `<@${member.id}> now owns this voice channel.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.permit) {
        await owned.channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true });
        await interaction.reply({ content: `<@${userId}> can now join your channel.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.reject) {
        await owned.channel.permissionOverwrites.edit(userId, { Connect: false });
        if (member?.voice?.channelId === owned.channel.id && interaction.guild.members.me.permissions.has('MoveMembers')) {
            await member.voice.disconnect('Rejected from join-to-create channel').catch(() => null);
        }
        await interaction.reply({ content: `<@${userId}> has been rejected from your channel.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = {
    createLimitModal,
    createRenameModal,
    createVoicePanelPayload,
    handleVoicePanelButton,
    handleVoicePanelModal,
    handleVoicePanelUserSelect,
    voicePanelCustomIds,
};
