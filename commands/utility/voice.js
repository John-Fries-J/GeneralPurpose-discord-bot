const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { deleteTemporaryVoiceChannel, getGuildJoinToCreateConfig, getOwnedVoiceChannel, transferOwnership } = require('../../utils/joinToCreate');
const { getTempVoiceChannel, upsertTempVoiceChannel } = require('../../utils/store');
const { createVoicePanelPayload } = require('../../utils/voicePanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Manage your join-to-create voice channel.')
        .setDMPermission(false)
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
        const activeChannel = interaction.member?.voice?.channel;

        if (subcommand === 'panel') {
            return interaction.reply(await createVoicePanelPayload(interaction));
        }

        if (subcommand === 'claim') {
            if (!activeChannel) return interaction.reply({ content: 'Join the temporary voice channel first.', flags: MessageFlags.Ephemeral });
            const record = await getTempVoiceChannel(activeChannel.id);
            if (!record) return interaction.reply({ content: 'This is not a temporary join-to-create channel.', flags: MessageFlags.Ephemeral });
            if (record.ownerId === interaction.user.id) return interaction.reply({ content: 'You already own this channel.', flags: MessageFlags.Ephemeral });
            if (activeChannel.members.has(record.ownerId)) return interaction.reply({ content: 'The current owner is still in the channel.', flags: MessageFlags.Ephemeral });

            const updated = await transferOwnership(record, activeChannel, interaction.member);
            return interaction.reply({ content: `You now own <#${updated.channelId}>.`, flags: MessageFlags.Ephemeral });
        }

        const owned = await getOwnedVoiceChannel(interaction);
        if (!owned.ok) return interaction.reply({ content: owned.message, flags: MessageFlags.Ephemeral });

        const { channel } = owned;

        if (subcommand === 'limit') {
            const amount = interaction.options.getInteger('amount', true);
            const max = Number((await getGuildJoinToCreateConfig(interaction.guild.id)).userLimitMax || 25);
            if (amount > max) {
                return interaction.reply({ content: `The maximum allowed limit is ${max}.`, flags: MessageFlags.Ephemeral });
            }
            await channel.setUserLimit(amount, 'Voice owner changed user limit');
            await upsertTempVoiceChannel({ ...owned.record, userLimit: amount, name: channel.name });
            return interaction.reply({ content: `Voice channel limit set to ${amount || 'unlimited'}.`, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'name' || subcommand === 'rename') {
            const name = interaction.options.getString('name', true);
            await channel.setName(name, 'Voice owner renamed channel');
            await upsertTempVoiceChannel({ ...owned.record, name });
            return interaction.reply({ content: `Voice channel renamed to ${name}.`, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'transfer') {
            const user = interaction.options.getUser('user', true);
            const member = channel.members.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member || member.voice?.channelId !== channel.id || member.user.bot) {
                return interaction.reply({ content: 'Choose a human member currently in your voice channel.', flags: MessageFlags.Ephemeral });
            }
            await transferOwnership(owned.record, channel, member);
            return interaction.reply({ content: `<@${member.id}> now owns this voice channel.`, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'lock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
            await upsertTempVoiceChannel({ ...owned.record, locked: true, name: channel.name, userLimit: channel.userLimit || 0 });
            return interaction.reply({ content: 'Voice channel locked.', flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'unlock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
            await upsertTempVoiceChannel({ ...owned.record, locked: false, name: channel.name, userLimit: channel.userLimit || 0 });
            return interaction.reply({ content: 'Voice channel unlocked.', flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'delete') {
            await interaction.reply({ content: 'Deleting your temporary voice channel.', flags: MessageFlags.Ephemeral });
            await deleteTemporaryVoiceChannel(interaction.guild, channel.id, 'Voice owner deleted temporary channel', { force: true });
            return null;
        }

        const user = interaction.options.getUser('user', true);
        if (subcommand === 'permit') {
            await channel.permissionOverwrites.edit(user.id, { Connect: true, ViewChannel: true });
            return interaction.reply({ content: `<@${user.id}> can now join your channel.`, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'reject') {
            await channel.permissionOverwrites.edit(user.id, { Connect: false });
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member?.voice?.channelId === channel.id && interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                await member.voice.disconnect('Rejected from join-to-create channel').catch(() => null);
            }
            return interaction.reply({ content: `<@${user.id}> has been rejected from your channel.`, flags: MessageFlags.Ephemeral });
        }

        return null;
    },
};
