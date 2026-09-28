const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const language = require('../../utils/language');
const { fetchMember } = require('../../utils/discord');
const { sendLog, formatUser } = require('../../utils/logging');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nick')
        .setDescription('Change or clear a user nickname.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .addUserOption(option => option.setName('user').setDescription('The user to update.').setRequired(true))
        .addStringOption(option => option.setName('nickname').setDescription('The new nickname. Leave blank to clear.').setMaxLength(32))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the nickname change.')),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const nickname = interaction.options.getString('nickname');
        const reason = interaction.options.getString('reason') || 'Nickname updated';
        const member = await fetchMember(interaction.guild, user.id);

        if (!member) {
            return interaction.reply({ content: language.moderation.userNotInServer, flags: 64 });
        }

        if (!member.manageable) {
            return interaction.reply({ content: 'I cannot change this user nickname. Check my role position and permissions.', flags: 64 });
        }

        const oldNickname = member.nickname || member.user.username;
        await member.setNickname(nickname || null, reason);

        await sendLog(interaction.guild, {
            type: 'moderation',
            title: 'Nickname updated',
            color: 'blue',
            user,
            fields: [
                { name: 'User', value: formatUser(user), inline: true },
                { name: 'Moderator', value: formatUser(interaction.user), inline: true },
                { name: 'Old nickname', value: oldNickname, inline: true },
                { name: 'New nickname', value: nickname || 'Cleared', inline: true },
                { name: 'Reason', value: reason },
            ],
        }).catch(() => null);

        return interaction.reply({ content: `Nickname updated for ${user.tag}.`, flags: 64 });
    },
};
