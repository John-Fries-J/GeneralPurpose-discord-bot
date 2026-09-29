const repository = require('./storeRepository');

module.exports = {
    deleteEmbedTemplate: repository.deleteEmbedTemplate,
    listEmbedTemplates: repository.listEmbedTemplates,
    upsertEmbedTemplate: repository.upsertEmbedTemplate,
};
