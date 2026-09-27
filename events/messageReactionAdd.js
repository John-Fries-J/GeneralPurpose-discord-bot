const { Events } = require('discord.js');
const { handleReactionRoleAdd, handleStarboardReaction } = require('../utils/community');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        await handleReactionRoleAdd(reaction, user).catch(error => {
            console.error('Reaction role add failed:', error);
        });
        await handleStarboardReaction(reaction, user).catch(error => {
            console.error('Starboard reaction failed:', error);
        });
    },
};
