/* SocialHub Custom Header Web Component
   Implements a modular dashboard header with search, notifications, theme toggles, and mobile triggers. */

class Header extends HTMLElement {
    connectedCallback() {
        this.render();
        this.initThemeToggle();
        this.initMobileTrigger();
    }

    render() {
        this.innerHTML = `
            <header class="header-wrapper">
                <div class="header-left">
                    <button class="mobile-nav-toggle" id="mobileNavToggle" aria-label="Toggle Navigation">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                    <div class="header-search">
                        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" class="search-input" placeholder="Search posts, schedules, channels..." />
                    </div>
                </div>

                <div class="header-right">
                    <!-- Theme Toggle -->
                    <button class="header-action-btn" id="themeToggleBtn" title="Toggle Theme">
                        <!-- Sun Icon (shown in dark theme) -->
                        <svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="5"></circle>
                            <line x1="12" y1="1" x2="12" y2="3"></line>
                            <line x1="12" y1="21" x2="12" y2="23"></line>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                            <line x1="1" y1="12" x2="3" y2="12"></line>
                            <line x1="21" y1="12" x2="23" y2="12"></line>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                        </svg>
                        <!-- Moon Icon (shown in light theme) -->
                        <svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                        </svg>
                    </button>

                    <!-- Notifications -->
                    <button class="header-action-btn notification-btn" title="Notifications">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                        <span class="notification-badge"></span>
                    </button>

                    <div class="header-divider"></div>

                    <!-- User Profile Quick Actions -->
                    <div class="header-profile-trigger">
                        <div class="avatar-holder">
                            <span class="avatar-letters" id="headerInitials">JD</span>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }

    initThemeToggle() {
        const themeBtn = this.querySelector('#themeToggleBtn');
        if (!themeBtn) return;

        // Check local storage or prefers-color-scheme
        const savedTheme = localStorage.getItem('theme');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        let currentTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', currentTheme);

        themeBtn.addEventListener('click', () => {
            currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', currentTheme);
            localStorage.setItem('theme', currentTheme);
        });
    }

    initMobileTrigger() {
        const toggleBtn = this.querySelector('#mobileNavToggle');
        if (!toggleBtn) return;

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.querySelector('app-sidebar');
            if (sidebar) {
                sidebar.classList.toggle('active');
                this.toggleBackdrop(sidebar.classList.contains('active'));
            }
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            const sidebar = document.querySelector('app-sidebar');
            if (sidebar && sidebar.classList.contains('active')) {
                const isClickInside = sidebar.contains(e.target) || toggleBtn.contains(e.target);
                if (!isClickInside) {
                    sidebar.classList.remove('active');
                    this.toggleBackdrop(false);
                }
            }
        });
    }

    toggleBackdrop(show) {
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (show) {
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'sidebar-backdrop';
                Object.assign(backdrop.style, {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.4)',
                    backdropFilter: 'blur(3px)',
                    webkitBackdropFilter: 'blur(3px)',
                    zIndex: '95',
                    display: 'block'
                });
                document.body.appendChild(backdrop);
                
                backdrop.addEventListener('click', () => {
                    const sidebar = document.querySelector('app-sidebar');
                    if (sidebar) {
                        sidebar.classList.remove('active');
                    }
                    this.toggleBackdrop(false);
                });
            }
        } else {
            if (backdrop) {
                backdrop.remove();
            }
        }
    }
}

customElements.define('app-header', Header);
export default Header;
