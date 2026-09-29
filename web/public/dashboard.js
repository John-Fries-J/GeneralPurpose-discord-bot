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
