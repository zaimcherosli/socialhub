class PublishStatusBadge extends HTMLElement {
    static get observedAttributes() {
        return ['status'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'status') {
            this.render(newValue);
        }
    }

    connectedCallback() {
        const status = this.getAttribute('status') || 'draft';
        this.render(status);
    }

    render(status) {
        let bg = 'var(--color-bg-tertiary)';
        let fg = 'var(--color-text-secondary)';
        let label = status.toUpperCase();

        switch (status.toLowerCase()) {
            case 'draft':
                bg = 'var(--color-border)';
                fg = 'var(--color-text-tertiary)';
                break;
            case 'scheduled':
                bg = 'var(--color-primary-light)';
                fg = 'var(--color-primary)';
                break;
            case 'publishing':
                bg = '#fef3c7'; // yellow-100
                fg = '#d97706'; // yellow-600
                break;
            case 'published':
                bg = '#d1fae5'; // green-100
                fg = '#059669'; // green-600
                break;
            case 'failed':
                bg = '#fee2e2'; // red-100
                fg = '#dc2626'; // red-600
                break;
            case 'cancelled':
                bg = '#f3f4f6'; // grey-100
                fg = '#9ca3af'; // grey-400
                break;
        }

        this.innerHTML = `
            <span class="status-badge" style="
                display: inline-flex;
                align-items: center;
                padding: 0.25rem 0.75rem;
                border-radius: 9999px;
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                background-color: ${bg};
                color: ${fg};
            ">${label}</span>
        `;
    }
}

customElements.define('publish-status-badge', PublishStatusBadge);
export default PublishStatusBadge;
