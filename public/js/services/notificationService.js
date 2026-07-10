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
                bottom: '5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem',
                zIndex: '9999',
                width: 'max-content',
                maxWidth: 'calc(100vw - 2rem)',
                pointerEvents: 'none'
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
            padding: '0.85rem 1.25rem',
            borderRadius: '50px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            fontSize: '0.875rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            maxWidth: 'calc(100vw - 2rem)',
            width: 'max-content',
            textAlign: 'center',
            pointerEvents: 'auto',
            backdropFilter: 'blur(8px)',
            animation: 'toastSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        });

        toast.innerHTML = `<span>${icon}</span><span style="flex:1;word-break:break-word;">${message}</span>`;
        container.appendChild(toast);

        // Slide-up keyframe style injected dynamically if not present
        if (!document.getElementById('toastStyles')) {
            const style = document.createElement('style');
            style.id = 'toastStyles';
            style.textContent = `
                @keyframes toastSlideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes toastFadeOut {
                    to { opacity: 0; transform: translateY(10px); }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            toast.style.animation = 'toastFadeOut 0.4s ease forwards';
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },

    success(message, duration) { this.show(message, 'success', duration); },
    error(message, duration) { this.show(message, 'error', duration); },
    warning(message, duration) { this.show(message, 'warning', duration); },
    info(message, duration) { this.show(message, 'info', duration); }
};

export default notificationService;
