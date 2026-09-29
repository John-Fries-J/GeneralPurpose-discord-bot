const repository = require('./storeRepository');

module.exports = {
    createTicketTranscript: repository.createTicketTranscript,
    deleteTicketRecord: repository.deleteTicketRecord,
    getTicketRecord: repository.getTicketRecord,
    getTicketTranscript: repository.getTicketTranscript,
    listTicketRecords: repository.listTicketRecords,
    listTicketTranscripts: repository.listTicketTranscripts,
    upsertTicketRecord: repository.upsertTicketRecord,
};
