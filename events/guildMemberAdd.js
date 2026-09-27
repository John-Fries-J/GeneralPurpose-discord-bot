const { Events } = require('discord.js');
const { getConfig } = require('../utils/config');
const { findSendableChannel } = require('../utils/discord');
const { buildWelcomeEmbed } = require('../commands/utility/welcome');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const config = getConfig();

        if (config.welcomeID) {
            const channel = findSendableChannel(member.guild, config.welcomeID);
            if (channel) {
                const embed = buildWelcomeEmbed(member.user, member.guild);
                await channel.send({ content: `<@${member.user.id}>`, embeds: [embed] }).catch(error => {
                    console.error('Failed to send welcome message:', error);
                });
            } else {
                console.warn(`Welcome channel with ID ${config.welcomeID} was not found.`);
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
    },
};
