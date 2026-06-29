/* SocialHub Custom Sidebar Web Component
   Implements a light-DOM reusable component for easy global styling. */

class Sidebar extends HTMLElement {
    connectedCallback() {
        this.render();
        this.setActiveLink();
        this.initCloseButton();
    }

    render() {
        this.classList.add('sidebar-element');
        this.innerHTML = `
            <aside class="sidebar-wrapper">
                <div class="sidebar-brand">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1;">
                        <div class="brand-logo">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#brandGrad)" />
                                <path d="M12 7V17M7 12H17" stroke="white" stroke-width="2.5" stroke-linecap="round" />
                                <defs>
                                    <linearGradient id="brandGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                        <stop stop-color="#3b82f6" />
                                        <stop offset="1" stop-color="#1d4ed8" />
                                    </linearGradient>
                                </defs>
                            </svg>
                        </div>
                        <span class="brand-name">SocialHub</span>
                    </div>
                    <button class="mobile-close-btn" id="mobileCloseBtn" aria-label="Close Navigation">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <nav class="sidebar-nav">
                    <ul class="nav-list">
                        <li>
                            <a href="dashboard.html" class="nav-item" data-route="dashboard">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="7" height="9" rx="1" />
                                    <rect x="14" y="3" width="7" height="5" rx="1" />
                                    <rect x="14" y="12" width="7" height="9" rx="1" />
                                    <rect x="3" y="16" width="7" height="5" rx="1" />
                                </svg>
                                <span class="nav-label">Dashboard</span>
                            </a>
                        </li>
                        <li>
                            <a href="posts.html" class="nav-item" data-route="posts">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                                <span class="nav-label">Posts</span>
                            </a>
                        </li>
                        <li>
                            <a href="schedule.html" class="nav-item" data-route="schedule">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                <span class="nav-label">Schedule</span>
                            </a>
                        </li>
                        <li>
                            <a href="analytics.html" class="nav-item" data-route="analytics">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="20" x2="18" y2="10" />
                                    <line x1="12" y1="20" x2="12" y2="4" />
                                    <line x1="6" y1="20" x2="6" y2="14" />
                                </svg>
                                <span class="nav-label">Analytics</span>
                            </a>
                        </li>
                        <li>
                            <a href="accounts.html" class="nav-item" data-route="accounts">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                </svg>
                                <span class="nav-label">Accounts</span>
                            </a>
                        </li>
                        <li>
                            <a href="settings.html" class="nav-item" data-route="settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                                <span class="nav-label">Settings</span>
                            </a>
                        </li>
                    </ul>
                </nav>

                <div class="sidebar-footer">
                    <div class="user-avatar-row">
                        <div class="avatar-holder">
                            <span class="avatar-letters" id="sidebarInitials">JD</span>
                        </div>
                        <div class="user-info" style="flex: 1; min-width: 0;">
                            <span class="user-name" id="sidebarUserName">John Doe</span>
                            <span class="user-plan">Pro Admin</span>
                        </div>
                        <button class="header-action-btn" id="btnSidebarLogout" title="Log Out" style="padding: 0.35rem; color: var(--color-danger); background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                <polyline points="16 17 21 12 16 7"></polyline>
                                <line x1="21" y1="12" x2="9" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </aside>
        `;
    }

    setActiveLink() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'dashboard.html';
        const pageName = page.replace('.html', '');
        
        const navItems = this.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('data-route') === pageName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    initCloseButton() {
        const closeBtn = this.querySelector('#mobileCloseBtn');
        if (closeBtn) {
            console.log('📱 Sidebar Close Button bound!');
            closeBtn.addEventListener('click', (e) => {
                console.log('📱 Sidebar Close Button clicked!');
                e.preventDefault();
                e.stopPropagation();
                
                console.log('DOM Sidebar count:', document.querySelectorAll('app-sidebar').length);
                document.querySelectorAll('app-sidebar').forEach((el, idx) => {
                    console.log(`Sidebar #${idx} classes:`, el.className, 'classList:', [...el.classList]);
                });

                console.log('Before removal - sidebar classes:', this.className, 'classList:', [...this.classList]);
                this.classList.remove('active');
                console.log('After removal - sidebar classes:', this.className, 'classList:', [...this.classList]);
                
                const header = document.querySelector('app-header');
                console.log('Found app-header:', header);
                if (header) {
                    console.log('app-header toggleBackdrop type:', typeof header.toggleBackdrop);
                }
                if (header && typeof header.toggleBackdrop === 'function') {
                    header.toggleBackdrop(false);
                } else {
                    const backdrop = document.querySelector('.sidebar-backdrop');
                    console.log('Direct backdrop lookup:', backdrop);
                    if (backdrop) {
                        backdrop.remove();
                    }
                }
            });
        } else {
            console.warn('⚠️ Sidebar Close Button not found!');
        }
    }
}

customElements.define('app-sidebar', Sidebar);
export default Sidebar;
