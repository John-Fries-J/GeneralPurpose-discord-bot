const axios = require('axios');
const { getConfig, updateConfig } = require('./config');
const { createEmbed } = require('./embeds');

const defaultYoutubeMessages = {
    video: '{title}\n{url}',
    short: '{title}\n{url}',
    stream: '{title}\n{url}',
    community: '{title}\n{url}',
};

function fillTemplate(template, values) {
    return (template || '').replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function classifyYoutubeItem(item) {
    if (item.kind === 'community' || item.activityType === 'bulletin') return 'community';
    if (item.liveStreamingDetails || /\blive\b/i.test(item.title || '')) return 'stream';
    if (item.durationSeconds && item.durationSeconds <= 60) return 'short';
    if (/#shorts?\b/i.test(`${item.title || ''} ${item.description || ''}`)) return 'short';
    return 'video';
}

function parseIsoDurationSeconds(duration) {
    const match = String(duration || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function getYoutubeEntriesFromFeed(xml) {
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
        const entry = match[1];
        const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/&amp;/g, '&') || 'New YouTube upload';
        const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || new Date().toISOString();

        return {
            id: videoId,
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            publishedAt: Date.parse(published) || Date.now(),
            kind: 'video',
        };
    }).filter(item => item.id);
}

async function fetchYoutubeApiItems(config, target) {
    const apiKey = config.youtube?.apiKey;
    if (!apiKey) return null;

    const activities = await axios.get('https://www.googleapis.com/youtube/v3/activities', {
        params: {
            part: 'snippet,contentDetails',
            channelId: target.channelId,
            maxResults: 5,
            key: apiKey,
        },
    });

    const uploads = activities.data.items
        .map(item => ({
            id: item.contentDetails?.upload?.videoId || item.id,
            title: item.snippet?.title || 'New YouTube activity',
            description: item.snippet?.description || '',
            url: item.contentDetails?.upload?.videoId
                ? `https://www.youtube.com/watch?v=${item.contentDetails.upload.videoId}`
                : `https://www.youtube.com/channel/${target.channelId}/community`,
            publishedAt: Date.parse(item.snippet?.publishedAt) || Date.now(),
            activityType: item.snippet?.type,
            kind: item.snippet?.type === 'bulletin' ? 'community' : 'video',
        }))
        .filter(item => item.id);

    const videoIds = uploads.filter(item => item.kind === 'video').map(item => item.id);
    if (!videoIds.length) return uploads;

    const details = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
            part: 'contentDetails,liveStreamingDetails',
            id: videoIds.join(','),
            key: apiKey,
        },
    });

    const detailMap = new Map(details.data.items.map(item => [item.id, item]));
    return uploads.map(item => {
        const detail = detailMap.get(item.id);
        return {
            ...item,
            durationSeconds: parseIsoDurationSeconds(detail?.contentDetails?.duration),
            liveStreamingDetails: detail?.liveStreamingDetails,
        };
    });
}

async function fetchYoutubeFeedItems(target) {
    const response = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${target.channelId}`);
    return getYoutubeEntriesFromFeed(response.data);
}

async function fetchYoutubeItems(config, target) {
    try {
        const apiItems = await fetchYoutubeApiItems(config, target);
        if (apiItems) return apiItems;
    } catch (error) {
        console.error(`YouTube API check failed for ${target.channelId}, falling back to RSS:`, error.response?.data || error.message);
    }

    return fetchYoutubeFeedItems(target);
}

async function sendYoutubeAnnouncement(client, target, item) {
    const channel = await client.channels.fetch(target.discordChannelId).catch(() => null);
    if (!channel?.send) return false;

    const type = classifyYoutubeItem(item);
    const messages = { ...defaultYoutubeMessages, ...(target.messages || {}) };
    const content = fillTemplate(messages[type] || messages.video, {
        title: item.title,
        url: item.url,
        type,
        channel: target.name || target.channelId,
    });

    const embed = createEmbed({
        title: item.title,
        url: item.url,
        description: `YouTube ${type}`,
        color: 'red',
    });

    await channel.send({ content, embeds: [embed] });
    return true;
}

async function pollYoutube(client) {
    const config = getConfig();
    const targets = (config.youtube?.channels || []).filter(target => target.enabled !== false && target.channelId && target.discordChannelId);

    for (const target of targets) {
        try {
            const items = await fetchYoutubeItems(config, target);
            const newest = items.sort((a, b) => b.publishedAt - a.publishedAt)[0];
            if (!newest || newest.id === target.lastItemId) continue;

            if (target.lastItemId) {
                await sendYoutubeAnnouncement(client, target, newest);
            }

            updateConfig(current => {
                const currentTarget = current.youtube?.channels?.find(item => item.channelId === target.channelId && item.discordChannelId === target.discordChannelId);
                if (currentTarget) currentTarget.lastItemId = newest.id;
                return current;
            });
        } catch (error) {
            console.error(`YouTube announcement check failed for ${target.channelId}:`, error.response?.data || error.message);
        }
    }
}

async function fetchTwitchStream(twitchConfig, target) {
    const response = await axios.get('https://api.twitch.tv/helix/streams', {
        params: { user_id: target.streamerId },
        headers: {
            'Client-ID': twitchConfig.clientId,
            Authorization: `Bearer ${twitchConfig.accessToken}`,
        },
    });

    const stream = response.data.data[0];
    if (!stream || stream.type !== 'live') return null;

    return {
        id: stream.id,
        title: stream.title,
        game: stream.game_name || 'Unknown',
        url: `https://www.twitch.tv/${target.streamerName}`,
        thumbnail: stream.thumbnail_url?.replace('{width}', '320').replace('{height}', '180'),
    };
}

async function refreshTwitchAccessToken(twitchConfig) {
    if (!twitchConfig.clientId || !twitchConfig.clientSecret) return null;

    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id: twitchConfig.clientId,
            client_secret: twitchConfig.clientSecret,
            grant_type: 'client_credentials',
        },
    });

    const accessToken = response.data.access_token;
    const expiresIn = Number(response.data.expires_in || 0);
    const expiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;

    updateConfig(config => {
        config.twitch ||= {};
        config.twitch.accessToken = accessToken;
        config.twitch.accessTokenExpiresAt = expiresAt;
        return config;
    });

    return { ...twitchConfig, accessToken, accessTokenExpiresAt: expiresAt };
}

async function getFreshTwitchConfig(twitchConfig) {
    if (twitchConfig.accessToken && Number(twitchConfig.accessTokenExpiresAt || 0) > Date.now() + 60 * 1000) {
        return twitchConfig;
    }

    if (twitchConfig.clientSecret) {
        return refreshTwitchAccessToken(twitchConfig);
    }

    return twitchConfig.accessToken ? twitchConfig : null;
}

async function sendTwitchAnnouncement(client, target, stream) {
    const channel = await client.channels.fetch(target.discordChannelId).catch(() => null);
    if (!channel?.send) return false;

    const content = fillTemplate(target.message || '{streamer} is live: {title}\n{url}', {
        streamer: target.streamerName,
        title: stream.title,
        game: stream.game,
        url: stream.url,
    });

    const embed = createEmbed({
        title: stream.title,
        url: stream.url,
        description: `Playing ${stream.game}`,
        image: stream.thumbnail,
        color: 'purple',
    });

    await channel.send({ content, embeds: [embed] });
    return true;
}

async function pollTwitch(client) {
    const config = getConfig();
    const twitchConfig = config.twitch || {};
    const targets = (twitchConfig.channels || []).filter(target => target.enabled !== false && target.streamerId && target.streamerName && target.discordChannelId);
    if (!twitchConfig.clientId || !targets.length) return;

    let freshTwitchConfig = await getFreshTwitchConfig(twitchConfig).catch(error => {
        console.error('Failed to refresh Twitch access token:', error.response?.data || error.message);
        return null;
    });
    if (!freshTwitchConfig?.accessToken) return;

    for (const target of targets) {
        try {
            let stream;
            try {
                stream = await fetchTwitchStream(freshTwitchConfig, target);
            } catch (error) {
                if (error.response?.status !== 401 || !freshTwitchConfig.clientSecret) throw error;
                freshTwitchConfig = await refreshTwitchAccessToken(freshTwitchConfig);
                stream = await fetchTwitchStream(freshTwitchConfig, target);
            }

            if (stream && stream.id !== target.lastStreamId) {
                await sendTwitchAnnouncement(client, target, stream);
                updateConfig(current => {
                    const currentTarget = current.twitch?.channels?.find(item => item.streamerId === target.streamerId && item.discordChannelId === target.discordChannelId);
                    if (currentTarget) currentTarget.lastStreamId = stream.id;
                    return current;
                });
            }

            if (!stream && target.lastStreamId) {
                updateConfig(current => {
                    const currentTarget = current.twitch?.channels?.find(item => item.streamerId === target.streamerId && item.discordChannelId === target.discordChannelId);
                    if (currentTarget) currentTarget.lastStreamId = '';
                    return current;
                });
            }
        } catch (error) {
            console.error(`Twitch announcement check failed for ${target.streamerName}:`, error.response?.data || error.message);
        }
    }
}

function startMediaAnnouncementScheduler(client) {
    const run = () => {
        pollYoutube(client).catch(error => console.error('YouTube scheduler failed:', error));
        pollTwitch(client).catch(error => console.error('Twitch scheduler failed:', error));
    };

    run();
    return setInterval(run, 60 * 1000);
}

module.exports = {
    classifyYoutubeItem,
    fetchYoutubeItems,
    fillTemplate,
    getYoutubeEntriesFromFeed,
    getFreshTwitchConfig,
    parseIsoDurationSeconds,
    refreshTwitchAccessToken,
    startMediaAnnouncementScheduler,
};
