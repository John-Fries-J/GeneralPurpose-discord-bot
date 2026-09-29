module.exports = {
    ...require('./storeRepository'),
    moderation: require('./moderationRepository'),
    tickets: require('./ticketsRepository'),
    guildSettings: require('./guildSettingsRepository'),
    leveling: require('./levelingRepository'),
    history: require('./historyRepository'),
    scheduler: require('./schedulerRepository'),
    voice: require('./voiceRepository'),
    embeds: require('./embedRepository'),
    starboard: require('./starboardRepository'),
};
