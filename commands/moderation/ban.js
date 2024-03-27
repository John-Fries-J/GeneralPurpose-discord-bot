const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { red } = require('../../colors.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban'))
        .addStringOption(option => option.setName('duration').setDescription('The duration of the ban (e.g., 1d, 1h)').setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const duration = interaction.options.getString('duration');

        const member = interaction.guild.members.cache.get(user.id);

        if (!interaction.member.permissions.has('BAN_MEMBERS')) {
            return await interaction.reply({ content: 'You do not have permission to use this command', ephemeral: true });
        }

        if (!member.bannable) {
            return await interaction.reply({ content: 'I cannot ban this user', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('User Banned')
            .setDescription(`You have been banned from the server${reason ? ` for the following reason: ${reason}` : ''}`)
            .setTimestamp()
            .setColor(red);

        try {
            await member.send({ embeds: [embed] });
        } catch (error) {
            await member.ban({ reason: `${reason} | Users DMS were disabled` });
            return await interaction.reply({ content: `Unable to send message to user's DMs. User may have DMs disabled. User still banned! for ${reason}`, ephemeral: true });
        }

        await member.ban({ reason: reason });

        await interaction.reply({ content: `User ${user.tag} has been banned from the server for ${reason}`, ephemeral: true });

        if (duration) {
            const durationInMillis = parseDuration(duration);
            if (!isNaN(durationInMillis) && durationInMillis > 0) {
                setTimeout(async () => {
                    await interaction.guild.members.unban(user.id, 'Automatic unban after specified duration');
                }, durationInMillis);
            }
        }
    },
};

function parseDuration(duration) {
    const regex = /(\d+)([smhdwMy]|mo(?:nths?)?|y(?:ears?))?/i;
    const match = duration.match(regex);
    if (!match) return NaN;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'mo':
        case 'mon':
        case 'mons':
            return value * 30 * 24 * 60 * 60 * 1000;
        case 'y':
        case 'yr':
        case 'yrs':
            return value * 365 * 24 * 60 * 60 * 1000;
        default:
            return NaN;
    }
}
