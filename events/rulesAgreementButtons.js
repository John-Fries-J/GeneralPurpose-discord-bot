const { Events } = require('discord.js');
const { handleRulesAgreementButton } = require('../utils/community');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        await handleRulesAgreementButton(interaction).catch(error => {
            console.error('Rules agreement button failed:', error);
        });
    },
};
