import { apiClient } from '../utils/api.js';

class Sidebar extends HTMLElement {
    connectedCallback() {
        this.render();
        this.setActiveLink();
        this.initCloseButton();
        this.initWorkspaceSwitcher();
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

                <!-- Workspace Switcher Section -->
                <div class="workspace-switcher-container" style="position: relative; z-index: 999; padding: 0 1.25rem 1rem 1.25rem; border-bottom: 1px solid var(--color-border); margin-bottom: 1rem;">
                    <div class="dropdown" style="position: relative; width: 100%;">
                        <button class="btn btn-secondary" id="workspaceDropdownBtn" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; font-size: 0.85rem; font-weight: 600; text-align: left; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-primary); cursor: pointer; box-shadow: var(--shadow-sm);">
                            <span style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary); flex-shrink: 0;">
                                    <rect x="3" y="3" width="7" height="9" rx="1" />
                                    <rect x="14" y="3" width="7" height="5" rx="1" />
                                    <rect x="14" y="12" width="7" height="9" rx="1" />
                                    <rect x="3" y="16" width="7" height="5" rx="1" />
                                </svg>
                                <span id="currentWorkspaceName" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Loading...</span>
                            </span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-left: 0.25rem;">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                        <div class="dropdown-menu" id="workspaceDropdownMenu" style="display: none; position: absolute; top: 100%; left: 0; right: 0; margin-top: 0.25rem; background: var(--color-bg-dropdown, #ffffff); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--color-border); border-radius: var(--radius-sm); box-shadow: var(--shadow-md); z-index: 9999; max-height: 250px; overflow-y: auto; padding: 0.5rem 0;">
                            <div style="padding: 0.5rem 1rem; font-size: 0.7rem; color: var(--color-text-tertiary); text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Switch Workspace</div>
                            <div id="workspaceListItems"></div>
                            <div style="border-top: 1px solid var(--color-border); margin: 0.5rem 0;"></div>
                            <button class="dropdown-item" id="btnCreateWorkspace" style="width: 100%; text-align: left; padding: 0.5rem 1rem; background: none; border: none; font-size: 0.85rem; font-weight: 600; color: var(--color-primary); cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                                Create Workspace
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Create Workspace Modal Component -->
                <div class="modal-backdrop" id="createWorkspaceModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                    <div class="card" style="width: 100%; max-width: 400px; padding: 1.5rem; margin: 1rem; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); background: var(--color-bg-primary); border: 1px solid var(--color-border);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-primary); margin: 0;">Create Workspace</h3>
                            <button id="closeCreateWorkspaceModal" style="background: none; border: none; cursor: pointer; color: var(--color-text-tertiary); display: flex; align-items: center; justify-content: center; padding: 0.25rem;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                        <form id="createWorkspaceForm" style="display: flex; flex-direction: column; gap: 1.25rem;">
                            <div>
                                <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 0.5rem;">Workspace Name</label>
                                <input type="text" id="newWorkspaceNameInput" class="form-input" placeholder="e.g. Zaim Pro Workspace" required style="width: 100%; padding: 0.6rem 0.75rem; box-sizing: border-box;">
                            </div>
                            <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                                <button type="button" id="btnCancelCreateWorkspace" class="btn btn-secondary" style="cursor: pointer;">Cancel</button>
                                <button type="submit" class="btn btn-primary" style="cursor: pointer;">Create</button>
                            </div>
                        </form>
                    </div>
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
                                <span class="nav-label">Post</span>
                            </a>
                        </li>
                        <li>
                            <a href="calendar.html" class="nav-item" data-route="calendar">
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
                            <a href="ai-generate.html" class="nav-item" data-route="ai-generate">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                                    <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5 5 3Z" />
                                    <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
                                </svg>
                                <span class="nav-label">AI Generator</span>
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
                        <div class="user-info" style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
                            <span class="user-name" id="sidebarUserName">John Doe</span>
                            <span class="user-plan">Admin Pro</span>
                            <span class="user-version" style="font-size: 0.65rem; color: var(--color-text-tertiary); font-weight: 500; margin-top: 0.1rem;">v0.17.26</span>
                        </div>
                        <button class="header-action-btn" id="btnSidebarLogout" title="Logout" style="padding: 0.35rem; color: var(--color-danger); background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;">
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

    async initWorkspaceSwitcher() {
        const btnToggle = this.querySelector('#workspaceDropdownBtn');
        const menu = this.querySelector('#workspaceDropdownMenu');
        const listContainer = this.querySelector('#workspaceListItems');
        const currentNameEl = this.querySelector('#currentWorkspaceName');
        const btnCreate = this.querySelector('#btnCreateWorkspace');
        const modal = this.querySelector('#createWorkspaceModal');
        const form = this.querySelector('#createWorkspaceForm');
        const btnCancel = this.querySelector('#btnCancelCreateWorkspace');
        const btnCloseModal = this.querySelector('#closeCreateWorkspaceModal');
        const nameInput = this.querySelector('#newWorkspaceNameInput');

        if (!btnToggle || !menu) return;

        // Toggle dropdown open/close
        btnToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            menu.style.display = isOpen ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });

        menu.addEventListener('click', (e) => e.stopPropagation());

        // Fetch user workspaces
        try {
            // 1. Get list of workspaces using apiClient (handles token and correct base url automatically)
            const data = await apiClient.get('/workspaces');

            // 2. Get active workspace info
            const meData = await apiClient.get('/workspaces/me');

            if (meData.success && meData.workspace) {
                currentNameEl.textContent = meData.workspace.name;
                // Update workspace role/plan badge in sidebar footer
                const badgeEl = this.querySelector('.user-plan');
                if (badgeEl) {
                    badgeEl.textContent = `${meData.workspace.subscription_plan.toUpperCase()} (${meData.workspace.role.toUpperCase()})`;
                }
            }

            if (data.success && data.workspaces) {
                listContainer.innerHTML = '';
                data.workspaces.forEach(ws => {
                    const isCurrent = meData.success && meData.workspace && ws.id === meData.workspace.workspace_id;
                    const item = document.createElement('button');
                    item.className = 'dropdown-item';
                    item.style.cssText = `
                        width: 100%;
                        text-align: left;
                        padding: 0.6rem 1rem;
                        background: none;
                        border: none;
                        font-size: 0.85rem;
                        font-weight: ${isCurrent ? '700' : '500'};
                        color: ${isCurrent ? 'var(--color-primary)' : 'var(--color-text-primary)'};
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 0.5rem;
                        transition: background var(--transition-fast);
                    `;
                    item.addEventListener('mouseenter', () => item.style.background = 'var(--color-bg-secondary)');
                    item.addEventListener('mouseleave', () => item.style.background = 'none');

                    item.innerHTML = `
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ws.name}</span>
                        ${isCurrent ? `
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary); flex-shrink: 0;">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        ` : ''}
                    `;

                    // Switch event
                    if (!isCurrent) {
                        item.addEventListener('click', async () => {
                            try {
                                const switchData = await apiClient.post('/workspaces/switch', { workspace_id: ws.id });
                                if (switchData.success) {
                                    window.location.reload();
                                } else {
                                    alert(switchData.message || 'Failed to switch workspace.');
                                }
                            } catch (err) {
                                console.error('Error switching workspace:', err);
                            }
                        });
                    }

                    listContainer.appendChild(item);
                });
            }

            // Create Workspace Modal Toggles
            btnCreate.addEventListener('click', () => {
                // Pre-check if current workspace is pro/agency/enterprise
                if (meData.success && meData.workspace && !['pro', 'agency', 'enterprise'].includes(meData.workspace.subscription_plan)) {
                    alert('⚠️ Ruang kerja (Workspace) tambahan hanya boleh ditambah jika anda melanggan pelan PRO, AGENCY, atau ENTERPRISE.\n\nSila upgrade pelan anda di halaman Settings.');
                    menu.style.display = 'none';
                    return;
                }
                modal.style.display = 'flex';
                menu.style.display = 'none';
                nameInput.focus();
            });

            const hideModal = () => {
                modal.style.display = 'none';
                nameInput.value = '';
            };

            btnCancel.addEventListener('click', hideModal);
            btnCloseModal.addEventListener('click', hideModal);

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();
                if (!name) return;

                try {
                    const createData = await apiClient.post('/workspaces', {
                        name,
                        slug: `workspace-${Date.now()}`
                    });
                    if (createData.success) {
                        window.location.reload();
                    } else {
                        alert(createData.message || 'Failed to create workspace.');
                    }
                } catch (err) {
                    console.error('Error creating workspace:', err);
                    alert('An error occurred while creating workspace.');
                }
            });

        } catch (err) {
            console.error('Error listing workspaces:', err);
        }
    }
}

customElements.define('app-sidebar', Sidebar);
export default Sidebar;
