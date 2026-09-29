const repository = require('./storeRepository');

module.exports = {
    addModNote: repository.addModNote,
    clearWarningCases: repository.clearWarningCases,
    countActiveModerationCases: repository.countActiveModerationCases,
    createModerationCase: repository.createModerationCase,
    deleteModNote: repository.deleteModNote,
    getModerationCase: repository.getModerationCase,
    getTempMute: repository.getTempMute,
    listExpiredTempBans: repository.listExpiredTempBans,
    listExpiredTempMutes: repository.listExpiredTempMutes,
    listExpiredTempRoles: repository.listExpiredTempRoles,
    listModerationCases: repository.listModerationCases,
    listModNotes: repository.listModNotes,
    removeTempBan: repository.removeTempBan,
    removeTempMute: repository.removeTempMute,
    removeTempRole: repository.removeTempRole,
    updateModerationCaseReason: repository.updateModerationCaseReason,
    upsertTempBan: repository.upsertTempBan,
    upsertTempMute: repository.upsertTempMute,
    upsertTempRole: repository.upsertTempRole,
};
