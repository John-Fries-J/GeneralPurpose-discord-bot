function formatTemplate(template, values = {}) {
    return String(template || '').replace(/\${(\w+)}/g, (_, key) => values[key] ?? '');
}

module.exports = {
    formatTemplate,
};
