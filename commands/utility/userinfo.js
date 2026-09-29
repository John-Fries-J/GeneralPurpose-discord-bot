const { InteractionContextType, ApplicationIntegrationType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');
const { fetchMember } = require('../../utils/discord');

function formatDate(date) {
    if (!date) return 'Unknown';
    return date.toLocaleString('en-GB', {
        timeZone: 'GMT',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Look up a user by Discord ID.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option => option.setName('id').setDescription('The Discord user ID.').setRequired(true)),

    async execute(interaction) {
        const id = interaction.options.getString('id', true).trim();
        const user = await interaction.client.users.fetch(id).catch(() => null);

        if (!user) {
            return interaction.reply({ content: 'I could not find a user with that ID.', flags: MessageFlags.Ephemeral });
        }

        const embed = await buildUserInfoEmbed(interaction.guild, user);

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
    buildUserInfoEmbed,
};

async function buildUserInfoEmbed(guild, user) {
    const member = await fetchMember(guild, user.id);
    return createEmbed({
        title: 'User Info',
        thumbnail: user.displayAvatarURL({ dynamic: true }),
        color: 'blue',
        fields: [
            { name: 'User', value: `${user.tag} (${user.id})` },
            { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
            { name: 'Account Created', value: formatDate(user.createdAt), inline: true },
            { name: 'Joined Server', value: formatDate(member?.joinedAt), inline: true },
            { name: 'Highest Role', value: member?.roles?.highest ? `<@&${member.roles.highest.id}>` : 'Not in server', inline: true },
        ],
    });
}
