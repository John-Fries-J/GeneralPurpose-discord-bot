const { handleRulesAgreementButton } = require('../../utils/community');
const { handleHoneypotButton } = require('../../utils/honeypot');
const { handleMusicButton } = require('../../utils/musicButtons');
const { handleTicketButton } = require('../../utils/tickets');
const { handleVoicePanelButton } = require('../../utils/voicePanel');

const buttonHandlers = [
    handleHoneypotButton,
    handleRulesAgreementButton,
    handleMusicButton,
    handleVoicePanelButton,
    handleTicketButton,
];

async function routeButtonInteraction(interaction) {
    if (!interaction.guild) return false;

    for (const handler of buttonHandlers) {
        if (await handler(interaction)) return true;
    }

    return false;
}

module.exports = {
    buttonHandlers,
    routeButtonInteraction,
};
