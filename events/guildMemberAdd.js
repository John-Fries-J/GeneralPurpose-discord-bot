const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { findSendableChannel } = require('../utils/discord');
const { getGuildSettings } = require('../utils/guildConfig');
const { refreshMemberCounters } = require('../utils/memberCounters');
const { syncMember } = require('../utils/namelessmc');
const { buildWelcomeEmbed } = require('../commands/utility/welcome');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const [config, guildConfig] = await Promise.all([
            Promise.resolve(getConfig()),
            getGuildSettings(member.guild.id),
        ]);

        if (guildConfig.welcome?.enabled && guildConfig.welcome.channelId) {
            const channel = findSendableChannel(member.guild, guildConfig.welcome.channelId);
            if (channel) {
                const embed = buildWelcomeEmbed(member.user, member.guild, guildConfig.WelcomeEmbed);
                await channel.send({ content: `<@${member.user.id}>`, embeds: [embed] }).catch(error => {
                    console.error('Failed to send welcome message:', error);
                });
            } else {
                console.warn(`Welcome channel with ID ${guildConfig.welcome.channelId} was not found.`);
            }
        }

        const roleIds = Array.isArray(config.roles?.autoRoleIds)
            ? config.roles.autoRoleIds
            : [config.roles?.autoRoleId].filter(Boolean);

        for (const roleId of roleIds) {
            if (!roleId || member.roles.cache.has(roleId)) continue;

            try {
                await member.roles.add(roleId);
                console.info(`Added role ${roleId} to ${member.user.tag}.`);
            } catch (error) {
                console.error(`Failed to add role ${roleId} to ${member.user.tag}:`, error);
            }
        }

        await refreshMemberCounters(member.guild).catch(error => {
            console.error('Failed to refresh counters after member join:', error);
        });

        await syncMember(member).catch(error => {
            console.error('Failed to sync NamelessMC member after join:', error);
        });
    },
};
