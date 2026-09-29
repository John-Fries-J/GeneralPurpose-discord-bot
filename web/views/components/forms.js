const { escapeHtml } = require('./html');

function renderOption(option, selectedValue = '') {
    const selected = String(option.value) === String(selectedValue) ? ' selected' : '';
    return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
}

function renderSelect(name, label, options, selectedValue = '', {
    emptyLabel = 'Not set',
    description = '',
} = {}) {
    return `<label>${escapeHtml(label)}
<select name="${escapeHtml(name)}">
<option value="">${escapeHtml(emptyLabel)}</option>
${options.map(option => renderOption(option, selectedValue)).join('')}
</select>
${description ? `<span class="field-help">${escapeHtml(description)}</span>` : ''}
</label>`;
}

function renderTextInput(name, label, value = '', {
    description = '',
    maxLength = '',
    max = '',
    min = '',
    placeholder = '',
    step = '',
    type = 'text',
} = {}) {
    return `<label>${escapeHtml(label)}
<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${maxLength ? ` maxlength="${escapeHtml(maxLength)}"` : ''}${min !== '' ? ` min="${escapeHtml(min)}"` : ''}${max !== '' ? ` max="${escapeHtml(max)}"` : ''}${step !== '' ? ` step="${escapeHtml(step)}"` : ''}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''}>
${description ? `<span class="field-help">${escapeHtml(description)}</span>` : ''}
</label>`;
}

function renderTextarea(name, label, value = '', {
    description = '',
    placeholder = '',
    rows = 5,
} = {}) {
    return `<label>${escapeHtml(label)}
<textarea name="${escapeHtml(name)}" rows="${escapeHtml(rows)}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''}>${escapeHtml(value)}</textarea>
${description ? `<span class="field-help">${escapeHtml(description)}</span>` : ''}
</label>`;
}

function renderToggle(name, label, checked = false, description = '') {
    return `<label class="setting-row toggle-row"><span><strong>${escapeHtml(label)}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ''}</span><span class="switch"><input name="${escapeHtml(name)}" type="checkbox"${checked ? ' checked' : ''}><span></span></span></label>`;
}

function renderSegmented(name, options, selectedValue) {
    return `<div class="segmented" role="radiogroup">${options.map(option => {
        const checked = String(option.value) === String(selectedValue);
        return `<label><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${checked ? ' checked' : ''}><span>${escapeHtml(option.label)}</span></label>`;
    }).join('')}</div>`;
}

function renderSettingsForm({
    title,
    description = '',
    section,
    session,
    body,
    action = '/dashboard-settings',
}) {
    return `<section class="panel settings-panel">
<form method="post" action="${escapeHtml(action)}" data-dirty-form>
${session?.csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">` : ''}
<input type="hidden" name="section" value="${escapeHtml(section)}">
<div class="settings-head"><div><h2>${escapeHtml(title)}</h2>${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}</div></div>
${body}
<div class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></div>
<div class="save-bar" data-save-bar>
<span>Unsaved changes</span>
<div class="split-actions">
<button class="secondary" type="reset" data-discard-changes>Discard</button>
<button class="success" type="submit">Save changes</button>
</div>
</div>
</form>
</section>`;
}

module.exports = {
    renderSegmented,
    renderSelect,
    renderSettingsForm,
    renderTextInput,
    renderTextarea,
    renderToggle,
};
