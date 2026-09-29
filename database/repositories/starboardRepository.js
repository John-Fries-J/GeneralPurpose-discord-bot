const repository = require('./storeRepository');

module.exports = {
    getStarboardMessage: repository.getStarboardMessage,
    upsertStarboardMessage: repository.upsertStarboardMessage,
};
