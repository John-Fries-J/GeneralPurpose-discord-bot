const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { orange } = require('../../colors.json');

function parseDuration(durationString) {
    const regex = /(\d+)(s|m|h|d|w)/;
    const matches = durationString.match(regex);
    if (!matches) return null;
    const [, time, unit] = matches;
    const timeInMs = parseInt(time);
    switch (unit) {
        case 's':
            return timeInMs * 1000;
        case 'm':
            return timeInMs * 60 * 1000;
        case 'h':
            return timeInMs * 60 * 60 * 1000;
        case 'd':
            return timeInMs * 24 * 60 * 60 * 1000;
        case 'w':
            return timeInMs * 7 * 24 * 60 * 60 * 1000;
        default:
            return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a user from the server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addUserOption(option => option.setName('user').setDescription('The user to mute').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('The duration of the mute e.g., 1s, 5m, 2h, 3d, 1w').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the mute').setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const durationString = interaction.options.getString('duration') || '0'; 
        const member = await interaction.guild.members.fetch(user);
        const durationInMs = parseDuration(durationString);
        if (!durationInMs) {
            return interaction.reply('Invalid duration format. Please use a valid format (e.g., 1s, 5m, 2h, 3d, 1w).');
        }
        try {
            member.timeout(durationInMs, reason);
        } catch (error) {
            console.error(error);
            return interaction.reply('Failed to mute the user.');
        }
        const embed = new EmbedBuilder()
            .setTitle('User Muted')
            .setDescription(`**${member.user.tag}** has been muted for ${durationString}.\n**Reason:** ${reason}`)
            .setColor(orange)
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });

        const dmEmbed = new EmbedBuilder()
            .setTitle('User Muted')
            .setDescription(`You have been muted in **${interaction.guild.name}** for ${durationString}.\n**Reason:** ${reason}`)
            .setColor(orange)
            .setTimestamp();
        await member.send({ embeds: [dmEmbed] });
    },
};
