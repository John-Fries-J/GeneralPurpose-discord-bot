const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Shows server statistics.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const guild = interaction.guild;
        await guild.members.fetch().catch(() => null);

        const humans = guild.members.cache.filter(member => !member.user.bot).size;
        const bots = guild.members.cache.filter(member => member.user.bot).size;
        const textChannels = guild.channels.cache.filter(channel => channel.isTextBased()).size;
        const voiceChannels = guild.channels.cache.filter(channel => channel.isVoiceBased()).size;

        const embed = createEmbed({
            title: 'Server Stats',
            thumbnail: guild.iconURL(),
            color: 'blue',
            fields: [
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Humans', value: `${humans}`, inline: true },
                { name: 'Bots', value: `${bots}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Text Channels', value: `${textChannels}`, inline: true },
                { name: 'Voice Channels', value: `${voiceChannels}`, inline: true },
                { name: 'Boost Level', value: `${guild.premiumTier}`, inline: true },
                { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
            ],
        });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
