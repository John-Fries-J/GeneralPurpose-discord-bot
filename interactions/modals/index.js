const { handleModerationContextModal } = require('../../utils/moderationContext');
const { handleTicketModal } = require('../../utils/tickets');
const { handleVoicePanelModal } = require('../../utils/voicePanel');

const modalHandlers = [
    handleModerationContextModal,
    handleTicketModal,
    handleVoicePanelModal,
];

async function routeModalInteraction(interaction) {
    if (!interaction.guild || !interaction.isModalSubmit?.()) return false;

    for (const handler of modalHandlers) {
        if (await handler(interaction)) return true;
    }

    return false;
}

module.exports = {
    modalHandlers,
    routeModalInteraction,
};
