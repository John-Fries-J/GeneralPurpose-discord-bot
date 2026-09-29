const repository = require('./storeRepository');

module.exports = {
    listConfigAudit: repository.listConfigAudit,
    listGuildLevelRewards: repository.listGuildLevelRewards,
    listGuildLogChannels: repository.listGuildLogChannels,
    listGuildSettings: repository.listGuildSettings,
    saveGuildConfigurationSection: repository.saveGuildConfigurationSection,
};
