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

// ==================== PWA SERVICE WORKER & INSTALLATION PROMPT ====================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('🚀 Service Worker registered successfully!', reg.scope))
            .catch(err => console.error('⚠️ Service Worker registration failed:', err));
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('beforeinstallprompt event stashed.');

    if (!localStorage.getItem('pwa_prompt_dismissed')) {
        showInstallPromotion();
    }
});

function showInstallPromotion() {
    if (document.getElementById('pwaInstallPrompt')) return;

    const promptDiv = document.createElement('div');
    promptDiv.id = 'pwaInstallPrompt';
    promptDiv.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px) saturate(180%);
        -webkit-backdrop-filter: blur(12px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 16px;
        padding: 1rem 1.25rem;
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
        display: flex;
        align-items: center;
        gap: 1rem;
        z-index: 9999;
        width: 90%;
        max-width: 440px;
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
        opacity: 0;
        box-sizing: border-box;
    `;

    promptDiv.innerHTML = `
        <div style="width: 44px; height: 44px; border-radius: 10px; overflow: hidden; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            <img src="socialhub_pwa_icon.png" alt="SocialHub Logo" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
        <div style="flex-grow: 1; min-width: 0;">
            <h4 style="margin: 0 0 0.15rem 0; font-family: var(--font-heading); font-size: 0.875rem; font-weight: 700; color: var(--color-text-primary);">Install SocialHub App</h4>
            <p style="margin: 0; font-size: 0.75rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Add to your home screen for mobile scheduling.</p>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button id="pwaDismissBtn" style="background: none; border: none; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-tertiary); cursor: pointer; padding: 0.5rem 0.75rem; border-radius: 8px;">Later</button>
            <button id="pwaInstallBtn" style="background: var(--color-primary); color: #fff; border: none; font-size: 0.8125rem; font-weight: 600; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,0.2);">Install</button>
        </div>
    `;

    document.body.appendChild(promptDiv);

    setTimeout(() => {
        promptDiv.style.transform = 'translateX(-50%) translateY(0)';
        promptDiv.style.opacity = '1';
    }, 100);

    document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        promptDiv.style.opacity = '0';
        promptDiv.style.transform = 'translateX(-50%) translateY(100px)';
        setTimeout(() => promptDiv.remove(), 400);

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to PWA install prompt: ${outcome}`);
        deferredPrompt = null;
    });

    document.getElementById('pwaDismissBtn').addEventListener('click', () => {
        promptDiv.style.opacity = '0';
        promptDiv.style.transform = 'translateX(-50%) translateY(100px)';
        setTimeout(() => promptDiv.remove(), 400);
        localStorage.setItem('pwa_prompt_dismissed', 'true');
    });
}

