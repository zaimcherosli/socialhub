class BottomNav extends HTMLElement {
    connectedCallback() {
        this.render();
        this.setActiveLink();
    }

    render() {
        this.innerHTML = `
            <nav class="bottom-nav-container">
                <a href="dashboard.html" class="bottom-nav-item" data-route="dashboard">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="7" height="9" rx="1" />
                        <rect x="14" y="3" width="7" height="5" rx="1" />
                        <rect x="14" y="12" width="7" height="9" rx="1" />
                        <rect x="3" y="16" width="7" height="5" rx="1" />
                    </svg>
                    <span class="bottom-nav-label">Dashboard</span>
                </a>
                <a href="posts.html" class="bottom-nav-item" data-route="posts">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span class="bottom-nav-label">Post</span>
                </a>
                <a href="ai-generate.html" class="bottom-nav-item" data-route="ai-generate">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary);">
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    </svg>
                    <span class="bottom-nav-label" style="font-weight: 600; color: var(--color-primary);">Jana AI</span>
                </a>
                <a href="calendar.html" class="bottom-nav-item" data-route="calendar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span class="bottom-nav-label">Jadual</span>
                </a>
                <a href="accounts.html" class="bottom-nav-item" data-route="accounts">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                    </svg>
                    <span class="bottom-nav-label">Akaun</span>
                </a>
            </nav>
            <style>
                .bottom-nav-container {
                    display: none;
                }
                
                @media (max-width: 768px) {
                    .bottom-nav-container {
                        display: flex;
                        position: fixed;
                        bottom: 0;
                        left: 0;
                        width: 100vw;
                        height: 64px;
                        background: rgba(255, 255, 255, 0.85);
                        backdrop-filter: blur(12px) saturate(180%);
                        -webkit-backdrop-filter: blur(12px) saturate(180%);
                        border-top: 1px solid var(--color-border);
                        justify-content: space-around;
                        align-items: center;
                        z-index: 1400;
                        box-shadow: 0 -4px 16px rgba(0,0,0,0.04);
                        padding-bottom: env(safe-area-inset-bottom);
                        box-sizing: border-box;
                    }
                    
                    .bottom-nav-item {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        gap: 0.25rem;
                        color: var(--color-text-secondary);
                        text-decoration: none;
                        flex: 1;
                        height: 100%;
                        transition: color var(--transition-fast);
                    }
                    
                    .bottom-nav-item.active {
                        color: var(--color-primary);
                    }
                    
                    .bottom-nav-label {
                        font-size: 0.65rem;
                        font-weight: 500;
                    }

                    body {
                        padding-bottom: 74px !important;
                    }
                }
            </style>
        `;
    }

    setActiveLink() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'dashboard.html';
        const pageName = page.replace('.html', '');
        
        const navItems = this.querySelectorAll('.bottom-nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('data-route') === pageName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
}

customElements.define('app-bottom-nav', BottomNav);
export default BottomNav;
