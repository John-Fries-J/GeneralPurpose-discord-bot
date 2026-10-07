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
const { createEmbed } = require('./embeds');
const { getGuildJoinToCreateConfig } = require('./joinToCreate');
const { getTempVoiceChannel } = require('./store');
const {
    VoiceControlError,
    claimTemporaryVoiceChannel,
    deleteOwnedVoiceChannel,
    lockOwnedVoiceChannel,
    permitVoiceMember,
    rejectVoiceMember,
    renameOwnedVoiceChannel,
    requireOwnedTemporaryVoiceChannel,
    setOwnedVoiceLimit,
    transferOwnedVoiceChannel,
    unlockOwnedVoiceChannel,
} = require('../services/voiceControlService');

const voicePanelCustomIds = {
    claim: 'voice:panel:claim',
    rename: 'voice:panel:rename',
    limit: 'voice:panel:limit',
    lock: 'voice:panel:lock',
    unlock: 'voice:panel:unlock',
    delete: 'voice:panel:delete',
    confirmDelete: 'voice:panel:delete-confirm',
    cancelDelete: 'voice:panel:delete-cancel',
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

function voiceErrorMessage(error) {
    if (error instanceof VoiceControlError) return error.message;
    return error?.message || 'Voice control failed.';
}

async function claimVoiceChannel(interaction) {
    try {
        const channel = await claimTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
        return interaction.reply({ content: `You now own <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
    } catch (error) {
        return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
}

async function handleVoicePanelButton(interaction) {
    if (!interaction.isButton?.() || !interaction.customId.startsWith('voice:panel:')) return false;

    if (interaction.customId === voicePanelCustomIds.claim) {
        await claimVoiceChannel(interaction);
        return true;
    }

    try {
        await requireOwnedTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
    } catch (error) {
        await interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.rename) {
        await interaction.showModal(createRenameModal());
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.limit) {
        const settings = await getGuildJoinToCreateConfig(interaction.guild.id);
        await interaction.showModal(createLimitModal(Number(settings.userLimitMax || 25)));
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.lock) {
        await lockOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, 'Voice owner locked channel from panel');
        await interaction.reply({ content: 'Voice channel locked.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.unlock) {
        await unlockOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, 'Voice owner unlocked channel from panel');
        await interaction.reply({ content: 'Voice channel unlocked.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.delete) {
        const owned = await requireOwnedTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
        await interaction.reply({
            content: `Delete <#${owned.channel.id}>? This disconnects members and removes the temporary channel.`,
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(voicePanelCustomIds.confirmDelete).setLabel('Delete Channel').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(voicePanelCustomIds.cancelDelete).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
            )],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.cancelDelete) {
        await interaction.reply({ content: 'Delete cancelled.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === voicePanelCustomIds.confirmDelete) {
        await interaction.reply({ content: 'Deleting your temporary voice channel.', flags: MessageFlags.Ephemeral });
        await deleteOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, 'Voice owner deleted temporary channel from panel');
        return true;
    }

    return false;
}

async function handleVoicePanelModal(interaction) {
    if (!interaction.isModalSubmit?.() || !interaction.customId.startsWith('voice:modal:')) return false;

    try {
        await requireOwnedTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
    } catch (error) {
        await interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.renameModal) {
        const name = interaction.fields.getTextInputValue('name').trim();
        await renameOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, name, 'Voice owner renamed channel from panel');
        await interaction.reply({ content: `Voice channel renamed to ${name}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.limitModal) {
        const rawLimit = interaction.fields.getTextInputValue('limit').trim();
        const amount = Number(rawLimit);
        const max = Number((await getGuildJoinToCreateConfig(interaction.guild.id)).userLimitMax || 25);
        if (!Number.isInteger(amount) || amount < 0 || amount > max) {
            await interaction.reply({ content: `Enter a whole number from 0 to ${max}.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        await setOwnedVoiceLimit(interaction.client, interaction.guild.id, interaction.user.id, amount, 'Voice owner changed user limit from panel');
        await interaction.reply({ content: `Voice channel limit set to ${amount || 'unlimited'}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handleVoicePanelUserSelect(interaction) {
    if (!interaction.isUserSelectMenu?.() || !interaction.customId.startsWith('voice:panel:')) return false;

    let owned;
    try {
        owned = await requireOwnedTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
    } catch (error) {
        await interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = interaction.values[0];
    const member = owned.channel.members.get(userId) || await interaction.guild.members.fetch(userId).catch(() => null);

    if (interaction.customId === voicePanelCustomIds.transfer) {
        await transferOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, userId, 'Voice owner transferred channel from panel');
        await interaction.reply({ content: `<@${member.id}> now owns this voice channel.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.permit) {
        await permitVoiceMember(interaction.client, interaction.guild.id, interaction.user.id, userId, 'Voice owner permitted user from panel');
        await interaction.reply({ content: `<@${userId}> can now join your channel.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === voicePanelCustomIds.reject) {
        await rejectVoiceMember(interaction.client, interaction.guild.id, interaction.user.id, userId, 'Voice owner rejected user from panel');
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
