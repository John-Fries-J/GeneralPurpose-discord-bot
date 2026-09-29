document.querySelectorAll('[data-command-search]').forEach(input => {
    input.addEventListener('input', () => {
        const root = document.querySelector(input.dataset.commandSearch);
        if (!root) return;
        const query = input.value.trim().toLowerCase();
        root.querySelectorAll('.command').forEach(command => {
            command.classList.toggle('is-hidden', query && !command.textContent.toLowerCase().includes(query));
        });
    });
});

document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem('dashboard-theme', nextTheme);
});

document.querySelectorAll('[data-collapse-target]').forEach(button => {
    button.addEventListener('click', () => {
        const target = document.querySelector(button.dataset.collapseTarget);
        if (!target) return;
        target.classList.toggle('is-collapsed');
        button.textContent = target.classList.contains('is-collapsed') ? 'Expand' : 'Collapse';
    });
});

document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(button.dataset.copy);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = button.dataset.copyLabel || 'Copy'; }, 900);
    });
});

document.querySelector('[data-audit-filter]')?.addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-audit-type]').forEach(entry => {
        entry.style.display = !query || entry.textContent.toLowerCase().includes(query) || entry.dataset.auditType.toLowerCase().includes(query) ? '' : 'none';
    });
});

const messageForm = document.querySelector('[data-message-form]');
if (messageForm) {
    const renderPreview = () => {
        const title = messageForm.embedTitle.value.trim() || 'Embed title';
        const description = messageForm.embedDescription.value.trim() || 'Embed description preview';
        const content = messageForm.content.value.trim() || 'Message content preview';
        document.querySelector('[data-preview-content]').textContent = content;
        document.querySelector('[data-preview-title]').textContent = title;
        document.querySelector('[data-preview-body]').textContent = description;
    };
    messageForm.addEventListener('input', renderPreview);
    renderPreview();
}

const serializeForm = form => new URLSearchParams(new FormData(form)).toString();
const dirtyForms = new Set();

document.querySelectorAll('[data-dirty-form]').forEach(form => {
    let initial = serializeForm(form);
    const feedback = form.querySelector('[data-form-feedback]');
    const submitButton = form.querySelector('button[type="submit"]');
    const setFeedback = (message, type = '') => {
        if (!feedback) return;
        feedback.textContent = message;
        feedback.hidden = !message;
        feedback.classList.toggle('success', type === 'success');
        feedback.classList.toggle('error', type === 'error');
    };
    const updateDirtyState = () => {
        const isDirty = serializeForm(form) !== initial;
        form.classList.toggle('is-dirty', isDirty);
        if (isDirty) {
            dirtyForms.add(form);
        } else {
            dirtyForms.delete(form);
        }
    };

    form.addEventListener('input', updateDirtyState);
    form.addEventListener('change', updateDirtyState);
    form.addEventListener('reset', () => {
        window.setTimeout(updateDirtyState, 0);
    });
    form.addEventListener('submit', async event => {
        if (!window.fetch) return;

        event.preventDefault();
        setFeedback('');
        if (submitButton) submitButton.disabled = true;

        try {
            const response = await fetch(form.action, {
                method: form.method || 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Dashboard-Async': '1',
                },
                body: serializeForm(form),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Settings were not saved.');
            }

            initial = serializeForm(form);
            form.classList.remove('is-dirty');
            dirtyForms.delete(form);
            setFeedback(data.message || 'Settings saved.', 'success');
        } catch (error) {
            updateDirtyState();
            setFeedback(error.message || 'Settings were not saved.', 'error');
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
});

window.addEventListener('beforeunload', event => {
    if (!dirtyForms.size) return;
    event.preventDefault();
    event.returnValue = '';
});
