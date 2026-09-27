const axios = require('axios');
const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { createEmbed } = require('../utils/embeds');

async function fetchTwitchStreamData(twitchConfig) {
    const response = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${twitchConfig.streamerId}`, {
        headers: {
            'Client-ID': twitchConfig.ClientId,
            Authorization: `Bearer ${twitchConfig.AccessToken}`,
        },
    });

    const streamData = response.data.data[0];
    if (!streamData || streamData.type !== 'live') return null;

    const userResponse = await axios.get(`https://api.twitch.tv/helix/users?id=${twitchConfig.streamerId}`, {
        headers: {
            'Client-ID': twitchConfig.ClientId,
            Authorization: `Bearer ${twitchConfig.AccessToken}`,
        },
    });

    const userData = userResponse.data.data[0];

    return {
        title: streamData.title,
        description: `Playing ${streamData.game_name || 'Unknown'}`,
        thumbnail: streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        profileImage: userData?.profile_image_url,
    };
}

async function sendStreamNotification(client, twitchConfig, streamData) {
    const channel = await client.channels.fetch(twitchConfig.discordChannelId).catch(() => null);
    if (!channel?.send) {
        console.error('Twitch notification channel not found.');
        return;
    }

    const streamUrl = `https://www.twitch.tv/${twitchConfig.streamerName}`;
    const twitchEmbed = createEmbed({
        title: streamData.title,
        url: streamUrl,
        description: streamData.description,
        image: streamData.thumbnail,
        thumbnail: streamData.profileImage,
        color: 'purple',
    });

    await channel.send({ embeds: [twitchEmbed] });
}

function hasTwitchConfig(twitchConfig) {
    return Boolean(
        twitchConfig?.ClientId
        && twitchConfig?.AccessToken
        && twitchConfig?.streamerId
        && twitchConfig?.discordChannelId
        && twitchConfig?.streamerName
    );
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const twitchConfig = getConfig().Twitch;
        if (!hasTwitchConfig(twitchConfig)) {
            console.log('Twitch notifications disabled. Add Twitch config values to enable them.');
            return;
        }

        let isLive = false;
        console.log('Twitch live event is active.');

        setInterval(async () => {
            try {
                const streamData = await fetchTwitchStreamData(twitchConfig);

                if (streamData && !isLive) {
                    isLive = true;
                    await sendStreamNotification(client, twitchConfig, streamData);
                    console.log('Streamer is live and notification sent.');
                    return;
                }

                if (!streamData && isLive) {
                    isLive = false;
                    console.log('Streamer is not live or stream ended.');
                }
            } catch (error) {
                console.error('Error checking Twitch stream:', error.response?.data || error.message);
            }
        }, 60 * 1000);
    },
};
