const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { getOwnedVoiceChannel } = require('../../utils/joinToCreate');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Manage your join-to-create voice channel.')
        .setDMPermission(false)
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
        .addSubcommand(subcommand => subcommand.setName('lock').setDescription('Prevent everyone from joining.'))
        .addSubcommand(subcommand => subcommand.setName('unlock').setDescription('Allow everyone to join.'))
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
        const owned = await getOwnedVoiceChannel(interaction);
        if (!owned.ok) return interaction.reply({ content: owned.message, ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const { channel } = owned;

        if (subcommand === 'limit') {
            const amount = interaction.options.getInteger('amount', true);
            const max = Number(getConfig().joinToCreate?.userLimitMax || 25);
            if (amount > max) {
                return interaction.reply({ content: `The maximum allowed limit is ${max}.`, ephemeral: true });
            }
            await channel.setUserLimit(amount, 'Voice owner changed user limit');
            return interaction.reply({ content: `Voice channel limit set to ${amount || 'unlimited'}.`, ephemeral: true });
        }

        if (subcommand === 'name') {
            const name = interaction.options.getString('name', true);
            await channel.setName(name, 'Voice owner renamed channel');
            return interaction.reply({ content: `Voice channel renamed to ${name}.`, ephemeral: true });
        }

        if (subcommand === 'lock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
            return interaction.reply({ content: 'Voice channel locked.', ephemeral: true });
        }

        if (subcommand === 'unlock') {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
            return interaction.reply({ content: 'Voice channel unlocked.', ephemeral: true });
        }

        const user = interaction.options.getUser('user', true);
        if (subcommand === 'permit') {
            await channel.permissionOverwrites.edit(user.id, { Connect: true, ViewChannel: true });
            return interaction.reply({ content: `<@${user.id}> can now join your channel.`, ephemeral: true });
        }

        if (subcommand === 'reject') {
            await channel.permissionOverwrites.edit(user.id, { Connect: false });
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member?.voice?.channelId === channel.id && interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                await member.voice.disconnect('Rejected from join-to-create channel').catch(() => null);
            }
            return interaction.reply({ content: `<@${user.id}> has been rejected from your channel.`, ephemeral: true });
        }
    },
};
