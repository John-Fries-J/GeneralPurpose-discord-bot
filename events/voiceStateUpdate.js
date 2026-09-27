const { Events } = require('discord.js');
const { handleJoinToCreate } = require('../utils/joinToCreate');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        await handleJoinToCreate(oldState, newState).catch(error => {
            console.error('Join-to-create handler failed:', error);
        });
    },
};
