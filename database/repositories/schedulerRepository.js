const repository = require('./storeRepository');

module.exports = {
    createReminder: repository.createReminder,
    createScheduledMessage: repository.createScheduledMessage,
    deleteScheduledMessage: repository.deleteScheduledMessage,
    listDueReminders: repository.listDueReminders,
    listDueScheduledMessages: repository.listDueScheduledMessages,
    listReminders: repository.listReminders,
    listScheduledJobStatus: repository.listScheduledJobStatus,
    listScheduledMessages: repository.listScheduledMessages,
    markScheduledJobFinish: repository.markScheduledJobFinish,
    markScheduledJobStart: repository.markScheduledJobStart,
    updateReminderStatus: repository.updateReminderStatus,
    updateScheduledMessageStatus: repository.updateScheduledMessageStatus,
};
