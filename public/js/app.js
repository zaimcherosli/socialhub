/* SocialHub Global App Controller
   Aggregates layouts, initializes common services, manages universal UI behaviors and dynamic user profile rendering. */

import './config.js';
import './components/Sidebar.js';
import './components/Header.js';
import './components/PublishStatusBadge.js';
import './components/ScheduleModal.js';
import './components/PostComposer.js';
import './components/ScheduledPostsTable.js';
import './components/UpcomingPostsCard.js';
import './components/BottomNav.js';
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
        
        // Instant synchronous hydration from local cache
        const cachedUser = authService.getUser();
        if (cachedUser) {
            this.updateUserInterface(cachedUser);
        }

        // Retrieve and verify active session context in background
        const user = await authService.getSession();
        if (user) {
            console.log(`👤 Active Session: ${user.name} (${user.email})`);
            this.updateUserInterface(user);
        } else if (!cachedUser) {
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
            const versionBadgeEl = document.getElementById('versionBadge');
            
            const initials = getInitials(user.name);
            
            if (nameEl) nameEl.textContent = user.name;
            if (sidebarInitialsEl) sidebarInitialsEl.textContent = initials;
            if (headerInitialsEl) headerInitialsEl.textContent = initials;
            if (versionBadgeEl && window.SYS_CONFIG?.VERSION) {
                versionBadgeEl.textContent = `v${window.SYS_CONFIG.VERSION}`;
            }

            // Dynamically inject Admin Console navigation link if user is admin
            if (user.role === 'admin') {
                const navList = document.querySelector('.nav-list');
                if (navList && !document.getElementById('adminNavLink')) {
                    const li = document.createElement('li');
                    li.id = 'adminNavLink';
                    li.innerHTML = `
                        <a href="admin.html" class="nav-item" data-route="admin" style="border-left: 3px solid var(--color-danger, #ef4444);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-danger, #ef4444);">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            <span class="nav-label" style="color: var(--color-danger, #ef4444); font-weight: 600;">Admin Console</span>
                        </a>
                    `;
                    navList.appendChild(li);
                    
                    // Re-evaluate active link highlight
                    const path = window.location.pathname;
                    const page = path.split('/').pop() || 'dashboard.html';
                    if (page === 'admin.html') {
                        const activeItem = li.querySelector('.nav-item');
                        if (activeItem) activeItem.classList.add('active');
                    }
                }
            }

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
        let isUpdating = false;

        function applyUpdate(waitingSW) {
            if (isUpdating) return;
            isUpdating = true;
            console.log('⚡ Triggering silent update activation...');
            if (waitingSW) {
                waitingSW.postMessage({ type: 'SKIP_WAITING' });
            }
        }

        function isUserEditing() {
            const activeEl = document.activeElement;
            if (!activeEl) return false;
            const tag = activeEl.tagName.toUpperCase();
            return tag === 'INPUT' || tag === 'TEXTAREA' || activeEl.isContentEditable;
        }

        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('🚀 Service Worker registered successfully!', reg.scope);

            // Force immediate check for updates on page load and tab focus
            reg.update().catch(() => {});
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    reg.update().catch(() => {});
                }
            });

            // ── Seamless Auto-Update Detection ──────────────────────────────────
            reg.addEventListener('updatefound', () => {
                const newSW = reg.installing;
                if (!newSW) return;

                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[App] New version installed in background');
                        applyUpdate(newSW);
                    }
                });
            });

            // If a SW is already waiting on load, auto-activate immediately
            if (reg.waiting && navigator.serviceWorker.controller) {
                console.log('[App] SW already waiting on load — auto-activating');
                applyUpdate(reg.waiting);
            }

        }).catch(err => console.error('⚠️ Service Worker registration failed:', err));

        // When the new SW takes control, seamlessly reload if not editing
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;

            const performReload = () => {
                refreshing = true;
                showSilentUpdateBadge();
                setTimeout(() => {
                    window.location.reload();
                }, 600);
            };

            if (isUserEditing()) {
                console.log('[App] User is currently typing — deferring update reload until tab switch or blur');
                const onNav = () => {
                    document.removeEventListener('visibilitychange', onNav);
                    performReload();
                };
                document.addEventListener('visibilitychange', onNav, { once: true });
            } else {
                performReload();
            }
        });
    });
}

/**
 * Show a sleek, non-intrusive auto-fading pill badge when update activates
 */
function showSilentUpdateBadge() {
    if (document.getElementById('swSilentBadge')) return;
    const badge = document.createElement('div');
    badge.id = 'swSilentBadge';
    const isMobile = window.innerWidth <= 768;
    const bottomPos = isMobile ? '78px' : '24px';
    badge.style.cssText = `
        position: fixed;
        bottom: ${bottomPos};
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.95), rgba(219, 39, 119, 0.95));
        color: #ffffff;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.5rem 1.1rem;
        border-radius: 50px;
        box-shadow: 0 8px 24px rgba(124, 58, 237, 0.35);
        z-index: 999999;
        opacity: 0;
        transition: all 0.3s ease;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    `;
    badge.innerHTML = `<span>✨</span><span>Kemaskini perisian digunakan...</span>`;
    document.body.appendChild(badge);
    requestAnimationFrame(() => {
        badge.style.opacity = '1';
        badge.style.transform = 'translateX(-50%) translateY(0)';
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

