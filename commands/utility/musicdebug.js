const { InteractionContextType, ApplicationIntegrationType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
    generateDependencyReport,
    getQueueSummary,
    getYtDlpCookieStatus,
} = require('../../utils/music');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('musicdebug')
        .setDescription('Show music voice diagnostics.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

    async execute(interaction) {
        const queue = getQueueSummary(interaction.guild.id);
        const cookies = getYtDlpCookieStatus();
        const report = generateDependencyReport()
            .split('\n')
            .filter(line => /@discordjs\/voice|discord\.js|libsodium|ffmpeg|node|dave/i.test(line))
            .join('\n')
            .slice(0, 1500);

        return interaction.reply({
            content: [
                `Voice: ${queue.connectionState || 'not connected'}`,
                `Current: ${queue.current?.title || 'none'}`,
                `Queued: ${queue.tracks.length}`,
                `Volume: ${queue.volume ?? 100}%`,
                `YouTube cookies: ${cookies.exists ? `found (${cookies.size} bytes)` : 'not found'}`,
                `Cookie path: ${cookies.resolvedPath || cookies.configuredPath || 'not configured'}`,
                '```',
                report,
                '```',
            ].join('\n'),
            flags: MessageFlags.Ephemeral,
        });
    },
};
