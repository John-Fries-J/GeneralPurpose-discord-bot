const repository = require('./storeRepository');

module.exports = {
    addUserHistory: repository.addUserHistory,
    listCommandStats: repository.listCommandStats,
    listGuildHistory: repository.listGuildHistory,
    listUserHistory: repository.listUserHistory,
    recordCommandUsage: repository.recordCommandUsage,
};
