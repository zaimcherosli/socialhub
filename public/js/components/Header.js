/* SocialHub Custom Header Web Component
   Implements a modular dashboard header with search, notifications, theme toggles, and mobile triggers. */

import { apiClient } from '../utils/api.js';

class Header extends HTMLElement {
    connectedCallback() {
        this.render();
        this.initThemeToggle();
        this.initMobileTrigger();
        this.initNotifications();
        this.initProfileInitials();
    }

    render() {
        this.innerHTML = `
            <style>
                .header-notification-container {
                    position: relative;
                    display: inline-block;
                }
                .notifications-dropdown-menu {
                    position: absolute;
                    top: calc(100% + 12px);
                    right: 0;
                    width: 330px;
                    max-height: 420px;
                    background: #ffffff; /* Solid opaque color for light mode */
                    border: 1px solid var(--color-border, #e2e8f0);
                    border-radius: var(--radius-md, 8px);
                    box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1));
                    display: flex;
                    flex-direction: column;
                    z-index: 1000;
                    overflow: hidden;
                    font-family: inherit;
                    animation: navDropdownFade 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                }
                :root[data-theme="dark"] .notifications-dropdown-menu {
                    background: #18181e; /* Solid opaque color for dark mode */
                }
                @media (prefers-color-scheme: dark) {
                    :root:not([data-theme="light"]) .notifications-dropdown-menu {
                        background: #18181e;
                    }
                }
                @keyframes navDropdownFade {
                    from { opacity: 0; transform: translateY(-8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .notifications-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--color-border, #e2e8f0);
                    font-weight: 600;
                    font-size: 0.85rem;
                    color: var(--color-text-primary, #1e293b);
                    background: var(--color-bg-secondary, #f8fafc);
                }
                .mark-all-read-btn {
                    background: none;
                    border: none;
                    color: var(--color-primary, #6366f1);
                    font-size: 0.75rem;
                    font-weight: 600;
                    cursor: pointer;
                    padding: 0;
                    transition: color 0.15s ease;
                }
                .mark-all-read-btn:hover {
                    color: var(--color-primary-hover, #4f46e5);
                    text-decoration: underline;
                }
                .notifications-list {
                    overflow-y: auto;
                    flex: 1;
                    max-height: 350px;
                }
                /* Custom Scrollbar for Notifications List */
                .notifications-list::-webkit-scrollbar {
                    width: 6px;
                }
                .notifications-list::-webkit-scrollbar-track {
                    background: transparent;
                }
                .notifications-list::-webkit-scrollbar-thumb {
                    background: var(--color-border, #cbd5e1);
                    border-radius: 3px;
                }
                .notification-item {
                    display: flex;
                    gap: 0.75rem;
                    padding: 0.85rem 1rem;
                    border-bottom: 1px solid var(--color-border, #e2e8f0);
                    cursor: pointer;
                    transition: background var(--transition-fast, 0.15s ease);
                    text-decoration: none;
                    color: inherit;
                }
                .notification-item:hover {
                    background: var(--color-bg-secondary, #f8fafc);
                }
                .notification-item.unread {
                    background: var(--color-bg-accent, rgba(99, 102, 241, 0.04));
                    border-left: 3.5px solid var(--color-primary, #6366f1);
                }
                .notification-item.unread:hover {
                    background: var(--color-bg-accent-hover, rgba(99, 102, 241, 0.07));
                }
                .notification-icon-wrap {
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .notification-icon-wrap.success { background: rgba(16, 185, 129, 0.1); color: #10b981; }
                .notification-icon-wrap.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
                .notification-icon-wrap.warning { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
                .notification-icon-wrap.info { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
                
                .notification-content {
                    display: flex;
                    flex-direction: column;
                    gap: 0.15rem;
                    min-width: 0;
                }
                .notification-title {
                    font-size: 0.8rem;
                    font-weight: 600;
                    color: var(--color-text-primary, #1e293b);
                }
                .notification-message {
                    font-size: 0.725rem;
                    color: var(--color-text-secondary, #64748b);
                    line-height: 1.35;
                    word-break: break-word;
                }
                .notification-time {
                    font-size: 0.65rem;
                    color: var(--color-text-tertiary, #94a3b8);
                    margin-top: 0.2rem;
                }
                .notifications-empty {
                    padding: 2.5rem 1rem;
                    text-align: center;
                    color: var(--color-text-tertiary, #94a3b8);
                    font-size: 0.8rem;
                    font-style: italic;
                }
                .notification-badge {
                    position: absolute;
                    top: 4px;
                    right: 4px;
                    background: var(--color-danger, #ef4444);
                    color: white;
                    border-radius: 50%;
                    min-width: 14px;
                    height: 14px;
                    padding: 0 3px;
                    font-size: 0.65rem;
                    font-weight: 700;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    border: 2px solid var(--color-bg-card, #ffffff);
                    pointer-events: none;
                }
                /* Mobile responsive alignment */
                @media (max-width: 480px) {
                    .notifications-dropdown-menu {
                        position: fixed;
                        top: calc(var(--header-height, 70px) + 8px);
                        left: 12px;
                        right: 12px;
                        width: auto;
                        max-height: calc(100vh - var(--header-height, 70px) - 24px);
                        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
                    }
                }
            </style>

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

                    <!-- Notifications Dropdown Container -->
                    <div class="header-notification-container">
                        <button class="header-action-btn notification-btn" id="notificationBtn" title="Notifications">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                            </svg>
                            <span class="notification-badge" id="notificationBadge"></span>
                        </button>
                        
                        <div class="notifications-dropdown-menu" id="notificationsDropdown" style="display: none;">
                            <div class="notifications-header">
                                <span>Notifikasi</span>
                                <button class="mark-all-read-btn" id="btnMarkAllRead">Tanda semua dibaca</button>
                            </div>
                            <div class="notifications-list" id="notificationsList">
                                <div class="notifications-empty">Tiada notifikasi baharu.</div>
                            </div>
                        </div>
                    </div>

                    <div class="header-divider"></div>

                    <!-- User Profile Quick Actions -->
                    <div class="header-profile-trigger">
                        <div class="avatar-holder">
                            <span class="avatar-letters" id="headerInitials">--</span>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }

    initThemeToggle() {
        const themeBtn = this.querySelector('#themeToggleBtn');
        if (!themeBtn) return;

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

    // Initialize Notification Center Dropdown and API integrations
    initNotifications() {
        const btn = this.querySelector('#notificationBtn');
        const dropdown = this.querySelector('#notificationsDropdown');
        const list = this.querySelector('#notificationsList');
        const badge = this.querySelector('#notificationBadge');
        const btnMarkAll = this.querySelector('#btnMarkAllRead');

        if (!btn || !dropdown || !list || !badge) return;

        // Fetch notifications silently on component mount to set initial badge status
        this.fetchAndRenderNotifications(false);

        // Fetch notifications periodically (every 30s)
        setInterval(() => this.fetchAndRenderNotifications(false), 30000);

        // Toggle dropdown on bell click
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'flex';
            if (!isVisible) {
                dropdown.style.display = 'flex';
                this.fetchAndRenderNotifications(true); // Fetch and open
            } else {
                dropdown.style.display = 'none';
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdown.style.display === 'flex' && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        // Mark all as read click handler
        btnMarkAll.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const res = await apiClient.post('/notifications/read', {});
                if (res.success) {
                    this.fetchAndRenderNotifications(false);
                }
            } catch (err) {
                console.error('[Notifications] Mark all read failed:', err);
            }
        });
    }

    // Fetch notifications list from server D1 and display in dropdown list
    async fetchAndRenderNotifications(isOpened = false) {
        const list = this.querySelector('#notificationsList');
        const badge = this.querySelector('#notificationBadge');
        if (!list || !badge) return;

        try {
            const res = await apiClient.get('/notifications');
            if (res.success && res.notifications) {
                const notifications = res.notifications;
                
                // Set Badge Counter
                const unreadCount = notifications.filter(n => n.is_read === 0).length;
                if (unreadCount > 0) {
                    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }

                // If dropdown is open or recently updated, render items list
                if (notifications.length === 0) {
                    list.innerHTML = `<div class="notifications-empty">Tiada notifikasi baharu.</div>`;
                    return;
                }

                list.innerHTML = '';
                notifications.forEach(item => {
                    const el = document.createElement('a');
                    el.className = `notification-item ${item.is_read === 0 ? 'unread' : ''}`;
                    el.href = item.link || '#';
                    
                    // Choose Icon based on type
                    let iconHtml = '';
                    if (item.type === 'success') {
                        iconHtml = `<div class="notification-icon-wrap success">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>`;
                    } else if (item.type === 'error') {
                        iconHtml = `<div class="notification-icon-wrap error">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>`;
                    } else if (item.type === 'warning') {
                        iconHtml = `<div class="notification-icon-wrap warning">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        </div>`;
                    } else {
                        iconHtml = `<div class="notification-icon-wrap info">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        </div>`;
                    }

                    // Format Time Ago
                    const timeAgo = this.formatTimeAgo(item.created_at);

                    el.innerHTML = `
                        ${iconHtml}
                        <div class="notification-content">
                            <span class="notification-title">${item.title}</span>
                            <span class="notification-message">${item.message}</span>
                            <span class="notification-time">${timeAgo}</span>
                        </div>
                    `;

                    // Click handler to mark read and redirect
                    el.addEventListener('click', async (e) => {
                        if (item.is_read === 0) {
                            try {
                                await apiClient.post('/notifications/read', { notification_id: item.id });
                            } catch (err) {
                                console.error('[Notifications] Failed to mark single item read:', err);
                            }
                        }
                    });

                    list.appendChild(el);
                });
            }
        } catch (err) {
            console.error('[Notifications] Fetch failed:', err);
        }
    }

    // Helper to format timestamps into readable Malaysian time periods
    formatTimeAgo(isoString) {
        try {
            // Treat SQLite space-separated timestamps as UTC (T + Z)
            let formattedString = isoString;
            if (isoString.includes(' ')) {
                formattedString = isoString.replace(' ', 'T') + 'Z';
            }
            const date = new Date(formattedString);
            const seconds = Math.floor((new Date() - date) / 1000);
            
            if (seconds < 60) return 'Baru sahaja';
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes} minit lalu`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours} jam lalu`;
            const days = Math.floor(hours / 24);
            if (days === 1) return 'Semalam';
            if (days < 7) return `${days} hari lalu`;
            
            return date.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
        } catch (_) {
            return 'Baru sahaja';
        }
    }

    async initProfileInitials() {
        const initialsEl = this.querySelector('#headerInitials');
        if (!initialsEl) return;
        try {
            const res = await apiClient.get('/users/me');
            if (res && res.success && res.user && res.user.name) {
                const names = res.user.name.split(' ');
                const initials = names.map(n => n.charAt(0)).join('').substring(0, 2).toUpperCase();
                initialsEl.textContent = initials || 'ZR';
            }
        } catch (_) {}
    }
}

customElements.define('app-header', Header);
export default Header;
