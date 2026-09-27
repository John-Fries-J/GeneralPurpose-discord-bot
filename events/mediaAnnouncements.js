const { Events } = require('discord.js');
const { startMediaAnnouncementScheduler } = require('../utils/mediaAnnouncements');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        client.mediaAnnouncementScheduler = startMediaAnnouncementScheduler(client);
    },
};
