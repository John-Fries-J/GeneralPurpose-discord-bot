const crypto = require('node:crypto');

function makeId(prefix = '') {
    return `${prefix}${crypto.randomUUID()}`;
}

module.exports = {
    makeId,
};
