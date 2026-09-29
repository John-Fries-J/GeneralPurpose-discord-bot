const { Events } = require('discord.js');
const { handleJoinToCreate } = require('../utils/joinToCreate');
const { handleMusicVoiceStateUpdate } = require('../services/musicLifecycle');
const { appendVoiceActivity } = require('../utils/store');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (oldState.channelId !== newState.channelId && (oldState.member || newState.member)) {
            const member = newState.member || oldState.member;
            const type = oldState.channelId && newState.channelId ? 'move' : (newState.channelId ? 'join' : 'leave');
            await appendVoiceActivity({
                guildId: newState.guild.id,
                userId: member.id,
                userTag: member.user?.tag || member.user?.username || member.id,
                oldChannelId: oldState.channelId,
                newChannelId: newState.channelId,
                type,
            }).catch(error => {
                console.error('Voice activity logging failed:', error);
            });
        }

        await handleJoinToCreate(oldState, newState).catch(error => {
            console.error('Join-to-create handler failed:', error);
        });

        await handleMusicVoiceStateUpdate(oldState, newState).catch(error => {
            console.error('Music voice lifecycle handler failed:', error);
        });
    },
};
