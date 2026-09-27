const { Events } = require('discord.js');
const { handleReactionRoleRemove } = require('../utils/community');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        await handleReactionRoleRemove(reaction, user).catch(error => {
            console.error('Reaction role remove failed:', error);
        });
    },
};
