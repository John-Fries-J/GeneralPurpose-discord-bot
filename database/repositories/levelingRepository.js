const repository = require('./storeRepository');

module.exports = {
    addUserXp: repository.addUserXp,
    getUserLevelRecord: repository.getUserLevelRecord,
    listLevelLeaderboard: repository.listLevelLeaderboard,
};
