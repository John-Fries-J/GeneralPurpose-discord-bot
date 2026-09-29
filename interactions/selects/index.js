const { handleModerationContextStringSelect } = require('../../utils/moderationContext');
const { handleHelpStringSelect } = require('../../utils/helpSystem');
const { handleSetupChannelSelect, handleSetupRoleSelect, handleSetupStringSelect } = require('../../utils/setupWizard');
const { handleTicketUserSelect } = require('../../utils/tickets');
const { handleVoicePanelUserSelect } = require('../../utils/voicePanel');

const selectHandlers = {
    string: [
        handleSetupStringSelect,
        handleHelpStringSelect,
        handleModerationContextStringSelect,
    ],
    user: [
        handleTicketUserSelect,
        handleVoicePanelUserSelect,
    ],
    role: [
        handleSetupRoleSelect,
    ],
    channel: [
        handleSetupChannelSelect,
    ],
    mentionable: [],
};

function getSelectType(interaction) {
    if (interaction.isStringSelectMenu?.()) return 'string';
    if (interaction.isUserSelectMenu?.()) return 'user';
    if (interaction.isRoleSelectMenu?.()) return 'role';
    if (interaction.isChannelSelectMenu?.()) return 'channel';
    if (interaction.isMentionableSelectMenu?.()) return 'mentionable';
    return null;
}

function isSelectInteraction(interaction) {
    return getSelectType(interaction) !== null;
}

async function routeSelectInteraction(interaction) {
    if (!interaction.guild) return false;

    const selectType = getSelectType(interaction);
    if (!selectType) return false;

    for (const handler of selectHandlers[selectType]) {
        if (await handler(interaction)) return true;
    }

    return false;
}

module.exports = {
    getSelectType,
    isSelectInteraction,
    routeSelectInteraction,
    selectHandlers,
};
