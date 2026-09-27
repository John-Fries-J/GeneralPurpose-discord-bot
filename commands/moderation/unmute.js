const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { fetchMember, safeDm } = require('../../utils/discord');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmutes a user from the server.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to unmute.').setRequired(true)),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const member = await fetchMember(interaction.guild, user.id);

        if (!member?.moderatable) {
            return interaction.reply({ content: 'I cannot unmute this user.', ephemeral: true });
        }

        await member.timeout(null, 'Unmuted');

        const embed = createEmbed({
            title: 'User Unmuted',
            description: `**${member.user.tag}** has been unmuted.`,
            color: 'green',
        });
        await interaction.reply({ embeds: [embed] });

        const dmEmbed = createEmbed({
            title: 'User Unmuted',
            description: `You have been unmuted in **${interaction.guild.name}**.`,
            color: 'green',
        });
        await safeDm(user, { embeds: [dmEmbed] });
    },
};
