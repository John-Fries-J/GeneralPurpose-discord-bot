const { InteractionContextType, ApplicationIntegrationType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getGuildJoinToCreateConfig } = require('../../utils/joinToCreate');
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
} = require('../../services/voiceControlService');
const { createVoicePanelPayload } = require('../../utils/voicePanel');

function voiceErrorMessage(error) {
    if (error instanceof VoiceControlError) return error.message;
    return error?.message || 'Voice control failed.';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Manage your join-to-create voice channel.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addSubcommand(subcommand => subcommand.setName('panel').setDescription('Open the interactive temporary voice control panel.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('limit')
                .setDescription('Set your voice channel user limit.')
                .addIntegerOption(option => option.setName('amount').setDescription('User limit. 0 removes the limit.').setMinValue(0).setMaxValue(99).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('name')
                .setDescription('Rename your voice channel.')
                .addStringOption(option => option.setName('name').setDescription('New channel name.').setMinLength(2).setMaxLength(100).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rename')
                .setDescription('Rename your voice channel.')
                .addStringOption(option => option.setName('name').setDescription('New channel name.').setMinLength(2).setMaxLength(100).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('claim').setDescription('Claim ownership if the current owner has left.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transfer')
                .setDescription('Transfer ownership to someone in your voice channel.')
                .addUserOption(option => option.setName('user').setDescription('New owner.').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('lock').setDescription('Prevent everyone from joining.'))
        .addSubcommand(subcommand => subcommand.setName('unlock').setDescription('Allow everyone to join.'))
        .addSubcommand(subcommand => subcommand.setName('delete').setDescription('Delete your temporary voice channel.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('permit')
                .setDescription('Allow a user to join.')
                .addUserOption(option => option.setName('user').setDescription('User to allow.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reject')
                .setDescription('Remove and block a user.')
                .addUserOption(option => option.setName('user').setDescription('User to reject.').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'panel') {
            return interaction.reply(await createVoicePanelPayload(interaction));
        }

        if (subcommand === 'claim') {
            try {
                const channel = await claimTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
                return interaction.reply({ content: `You now own <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        try {
            await requireOwnedTemporaryVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
        } catch (error) {
            return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'limit') {
            const max = Number((await getGuildJoinToCreateConfig(interaction.guild.id)).userLimitMax || 25);
            const amount = interaction.options.getInteger('amount', true);
            if (amount > max) return interaction.reply({ content: `The maximum allowed limit is ${max}.`, flags: MessageFlags.Ephemeral });
            try {
                await setOwnedVoiceLimit(interaction.client, interaction.guild.id, interaction.user.id, amount);
                return interaction.reply({ content: `Voice channel limit set to ${amount || 'unlimited'}.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'name' || subcommand === 'rename') {
            const name = interaction.options.getString('name', true);
            try {
                await renameOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, name);
                return interaction.reply({ content: `Voice channel renamed to ${name}.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'transfer') {
            const user = interaction.options.getUser('user', true);
            try {
                await transferOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, user.id);
                return interaction.reply({ content: `<@${user.id}> now owns this voice channel.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'lock') {
            try {
                await lockOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
                return interaction.reply({ content: 'Voice channel locked.', flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'unlock') {
            try {
                await unlockOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id);
                return interaction.reply({ content: 'Voice channel unlocked.', flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'delete') {
            await interaction.reply({ content: 'Deleting your temporary voice channel.', flags: MessageFlags.Ephemeral });
            await deleteOwnedVoiceChannel(interaction.client, interaction.guild.id, interaction.user.id, 'Voice owner deleted temporary channel').catch(() => null);
            return null;
        }

        const user = interaction.options.getUser('user', true);
        if (subcommand === 'permit') {
            try {
                await permitVoiceMember(interaction.client, interaction.guild.id, interaction.user.id, user.id);
                return interaction.reply({ content: `<@${user.id}> can now join your channel.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'reject') {
            try {
                await rejectVoiceMember(interaction.client, interaction.guild.id, interaction.user.id, user.id);
                return interaction.reply({ content: `<@${user.id}> has been rejected from your channel.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                return interaction.reply({ content: voiceErrorMessage(error), flags: MessageFlags.Ephemeral });
            }
        }

        return null;
    },
};
