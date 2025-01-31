const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { purple } = require('../colors.json');
const config = require('../config.json');

const clientId = config.Twitch.ClientId;
const accessToken = config.Twitch.AccessToken;
const streamerId = config.Twitch.streamerId;
const channelId = config.Twitch.discordChannelId;

async function fetchTwitchStreamData() {
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${streamerId}`, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const streamData = response.data.data[0];

        if (streamData && streamData.type === 'live') {
            return {
                title: streamData.title,
                description: `Playing ${streamData.game_name}`,
                thumbnail: streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
            };
        }

        return null;
    } catch (error) {
        console.error('Error fetching Twitch stream data:', error);
        return null;
    }
}

async function sendStreamNotification(client) {
    const streamData = await fetchTwitchStreamData();

    if (streamData) {
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            const streamURL = `https://www.twitch.tv/${config.Twitch.streamerName}`;
            const twitchEmbed = new EmbedBuilder()
                .setTitle(streamData.title)
                .setURL(streamURL)
                .setDescription(streamData.description)
                .setColor(purple)
                .setImage(streamData.thumbnail)
                .setTimestamp();

            channel.send({ embeds: [twitchEmbed] });
        } else {
            console.error('Channel not found');
        }
    } else {
        console.log('Streamer is not live.');
    }
}

let isLive = false;

module.exports = {
    name: 'ready',
    once: false,
    async execute(client) {
        if (!clientId) {console.error('You have set your ClientID in the twitch configuration incorrectly or there is an error.');return;}
        if (!accessToken) {console.error('You have set your accessToken in the twitch configuration incorrectly or there is an error.');return;}
        if (!streamerId) {console.error('You have set your streamerId in the twitch configuration incorrectly or there is an error.');return;}
        if (!channelId) {console.error('You have set your channelId in the twitch configuration incorrectly or there is an error.');return;}
        console.log('Twitch Live event is active.');

        setInterval(async () => {
            const streamData = await fetchTwitchStreamData();

            if (streamData) {
                if (!isLive) {
                    isLive = true;
                    await sendStreamNotification(client);
                    console.log('Streamer is live & notification sent.');
                }
            } else {
                if (isLive) {
                    isLive = false;
                    console.log('Streamer is not live or stream ended.');
                }
                isLive = false;
            }
        }, 300000); 
    }
};
