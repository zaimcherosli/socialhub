/* Reusable client UI toast notification service */
export const notificationService = {
    show(message, type = 'success', duration = 4000) {
        // Find or create toast container
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            Object.assign(container.style, {
                position: 'fixed',
                bottom: '2rem',
                right: '2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                zIndex: '2000'
            });
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast-message toast-${type}`;
        
        let icon = '🔔';
        let bg = 'var(--color-primary)';
        if (type === 'success') { icon = '✅'; bg = 'var(--color-success)'; }
        if (type === 'error') { icon = '❌'; bg = 'var(--color-danger)'; }
        if (type === 'warning') { icon = '⚠️'; bg = 'var(--color-warning)'; }

        Object.assign(toast.style, {
            background: bg,
            color: '#fff',
            padding: '1rem 1.5rem',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.875rem',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            minWidth: '280px',
            animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        });

        toast.innerHTML = `<span>${icon}</span><span style="flex:1;">${message}</span>`;
        container.appendChild(toast);

        // Slide-in keyframe style injected dynamically if not present
        if (!document.getElementById('toastStyles')) {
            const style = document.createElement('style');
            style.id = 'toastStyles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%) translateY(10px); opacity: 0; }
                    to { transform: translateX(0) translateY(0); opacity: 1; }
                }
                @keyframes fadeOut {
                    to { opacity: 0; transform: translateY(-10px); }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.4s ease forwards';
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },

    success(message, duration) { this.show(message, 'success', duration); },
    error(message, duration) { this.show(message, 'error', duration); },
    warning(message, duration) { this.show(message, 'warning', duration); },
    info(message, duration) { this.show(message, 'info', duration); }
};

export default notificationService;
