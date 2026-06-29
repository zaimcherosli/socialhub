/* SocialHub Global App Controller
   Aggregates layouts, initializes common services, manages universal UI behaviors and dynamic user profile rendering. */

import './components/Sidebar.js';
import './components/Header.js';
import './components/PublishStatusBadge.js';
import './components/ScheduleModal.js';
import './components/PostComposer.js';
import './components/ScheduledPostsTable.js';
import './components/UpcomingPostsCard.js';
import { authService } from './services/authService.js';

function getInitials(name) {
    if (!name) return 'JD';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

class App {
    constructor() {
        this.init();
    }

    async init() {
        console.log('🚀 SocialHub SaaS Foundation Initialized');
        
        // Retrieve and verify active session context
        const user = await authService.getSession();
        if (user) {
            console.log(`👤 Active Session: ${user.name} (${user.email})`);
            this.updateUserInterface(user);
        } else {
            console.warn('⚠️ No active session detected');
        }

        this.setupCommonUI();
    }

    updateUserInterface(user) {
        // Wait for Web Components to be connected and rendered
        setTimeout(() => {
            const nameEl = document.getElementById('sidebarUserName');
            const sidebarInitialsEl = document.getElementById('sidebarInitials');
            const headerInitialsEl = document.getElementById('headerInitials');
            
            const initials = getInitials(user.name);
            
            if (nameEl) nameEl.textContent = user.name;
            if (sidebarInitialsEl) sidebarInitialsEl.textContent = initials;
            if (headerInitialsEl) headerInitialsEl.textContent = initials;

            // Dynamically customize greeting on dashboard page
            const welcomeEl = document.querySelector('.page-subtitle');
            if (welcomeEl && (window.location.pathname.endsWith('dashboard.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/'))) {
                welcomeEl.textContent = `Welcome back, ${user.name}! Here's a summary of your automated social channels.`;
            }

            // Bind Sidebar logout button listener
            const btnLogout = document.getElementById('btnSidebarLogout');
            if (btnLogout) {
                btnLogout.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (confirm('Are you sure you want to log out of SocialHub?')) {
                        await authService.logout();
                    }
                });
            }
        }, 50);
    }

    setupCommonUI() {
        document.body.classList.add('app-loaded');
        
        window.addEventListener('popstate', () => {
            const sidebar = document.querySelector('app-sidebar');
            if (sidebar && typeof sidebar.setActiveLink === 'function') {
                sidebar.setActiveLink();
            }
        });
    }
}

// Instantiate the core application
document.addEventListener('DOMContentLoaded', () => {
    window.SocialHub = new App();
});
