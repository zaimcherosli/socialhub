import { schedulerService } from '../services/schedulerService.js';
import { publishService } from '../services/publishService.js';
import { timezoneService } from '../services/timezoneService.js';
import { notificationService } from '../services/notificationService.js';

class ScheduledPostsTable extends HTMLElement {
    connectedCallback() {
        this.renderContainer();
        this.loadData();
    }

    renderContainer() {
        this.innerHTML = `
            <div class="card" style="width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                    <h3 class="card-title" style="margin: 0; font-size: 1rem; font-weight: 600;">Scheduled Publications</h3>
                </div>
                <div class="table-responsive" style="overflow-x: auto; width: 100%;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--color-border); color: var(--color-text-tertiary); font-weight: 600;">
                                <th style="padding: 0.75rem 1rem; white-space: nowrap;">Platform</th>
                                <th style="padding: 0.75rem 1rem;">Content</th>
                                <th style="padding: 0.75rem 1rem; white-space: nowrap;">Publish At</th>
                                <th style="padding: 0.75rem 1rem;">Status</th>
                                <th style="padding: 0.75rem 1rem; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="scheduledTableBody">
                            <tr>
                                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--color-text-tertiary);">Loading schedules...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- View Post Modal Component -->
            <div class="modal-backdrop" id="viewPostModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                <div class="card" style="width: 100%; max-width: 450px; padding: 1.5rem; margin: 1rem; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); background: var(--color-bg-card, #ffffff); border: 1px solid var(--color-border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-primary); margin: 0;">Scheduled Post Details</h3>
                        <button id="closeViewPostModal" style="background: none; border: none; cursor: pointer; color: var(--color-text-tertiary); display: flex; align-items: center; justify-content: center; padding: 0.25rem;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase;">Platform</span>
                            <div id="viewPostPlatform" style="margin-top: 0.25rem; font-weight: 500; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;"></div>
                        </div>
                        <div>
                            <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase;">Publish At</span>
                            <div id="viewPostTime" style="margin-top: 0.25rem; color: var(--color-text-secondary); font-size: 0.9rem;"></div>
                        </div>
                        <div>
                            <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase;">Content</span>
                            <div id="viewPostContent" style="margin-top: 0.5rem; padding: 1rem; background: var(--color-bg-base, #f3f4f6); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 0.9rem; color: var(--color-text-primary); white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;"></div>
                        </div>
                    </div>
                    <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end;">
                        <button id="btnCancelViewPost" class="btn btn-secondary" style="cursor: pointer;">Close</button>
                    </div>
                </div>
            </div>
        `;
    }

    async loadData() {
        const tbody = this.querySelector('#scheduledTableBody');
        try {
            const res = await schedulerService.getScheduledPosts();
            let posts = res.results || [];
            tbody.innerHTML = '';

            if (posts.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 3rem; color: var(--color-text-tertiary); font-style: italic;">
                            No publications scheduled yet.
                        </td>
                    </tr>
                `;
                return;
            }

            // Sort: scheduled (1), draft (2), failed (3), published (4)
            posts.sort((a, b) => {
                const statusPriority = { scheduled: 1, draft: 2, failed: 3, published: 4 };
                const pA = statusPriority[a.status] || 99;
                const pB = statusPriority[b.status] || 99;
                if (pA !== pB) return pA - pB;
                // If status is same, sort by date (newest first for published, earliest first for scheduled)
                if (a.status === 'published') {
                    return new Date(b.publish_at) - new Date(a.publish_at);
                }
                return new Date(a.publish_at) - new Date(b.publish_at);
            });

            // Limit to max 10 posts to keep the page clean and prevent extreme scrolling
            posts = posts.slice(0, 10);

            posts.forEach(post => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--color-border)';
                
                const timeString = timezoneService.formatUtcToLocal(post.publish_at, { timeZoneName: undefined });
                
                // Simple platform label without logo/icons
                const platformHtml = `<span style="text-transform: capitalize; font-weight: 600;">${post.platform}</span>`;
                
                const truncatedContent = post.content 
                    ? (post.content.length > 60 ? post.content.substring(0, 60) + '...' : post.content)
                    : '<em style="color:var(--color-text-tertiary);">No content</em>';

                tr.innerHTML = `
                    <td data-label="Platform" style="padding: 1rem;">
                        ${platformHtml}
                    </td>
                    <td data-label="Content" style="padding: 1rem;">
                        <span class="cell-truncate-text">${truncatedContent}</span>
                    </td>
                    <td data-label="Publish At" style="padding: 1rem; color: var(--color-text-secondary); font-size: 0.8125rem; white-space: nowrap;">
                        ${timeString}
                    </td>
                    <td data-label="Status" style="padding: 1rem;">
                        <publish-status-badge status="${post.status}"></publish-status-badge>
                    </td>
                    <td data-label="Actions" style="padding: 1rem; text-align: right;">
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                            <button class="btn btn-secondary btn-sm btn-view-post" data-id="${post.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">View</button>
                            ${post.status === 'scheduled' || post.status === 'failed' ? `
                                <a href="post-editor.html?id=${post.id}&type=scheduled" class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; text-decoration: none; display: inline-flex; align-items: center;">Edit</a>
                                <button class="btn btn-secondary btn-sm btn-publish-now" data-id="${post.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">⚡ Now</button>
                                <button class="btn btn-danger btn-sm btn-cancel-post" data-id="${post.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Cancel</button>
                            ` : ''}
                        </div>
                    </td>
                `;

                tbody.appendChild(tr);
            });

            // Bind Modal View actions
            const modal = this.querySelector('#viewPostModal');
            const closeBtn = this.querySelector('#closeViewPostModal');
            const cancelBtn = this.querySelector('#btnCancelViewPost');
            const viewPlatform = this.querySelector('#viewPostPlatform');
            const viewTime = this.querySelector('#viewPostTime');
            const viewContent = this.querySelector('#viewPostContent');

            const hideModal = () => {
                modal.style.display = 'none';
            };
            closeBtn.addEventListener('click', hideModal);
            cancelBtn.addEventListener('click', hideModal);

            tbody.querySelectorAll('.btn-view-post').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const post = posts.find(p => String(p.id) === String(id));
                    if (!post) return;

                    viewPlatform.innerHTML = post.platform === 'threads' 
                        ? `<svg width="20" height="20" viewBox="0 0 192 192" fill="currentColor" style="color: var(--color-text-primary); vertical-align: middle; display: inline-block;">
                               <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.881 72.2328C81.6116 63.5383 90.6052 61.6848 97.2286 61.6848C97.3051 61.6848 97.3819 61.6848 97.4576 61.6855C105.707 61.7381 111.932 64.1366 115.961 68.814C118.893 72.2193 120.854 76.925 121.825 82.8638C114.511 81.6207 106.601 81.2385 98.145 81.7233C74.3247 83.0954 59.0111 96.9879 60.0396 116.292C60.5615 126.084 65.4397 134.508 73.775 140.011C80.8224 144.663 89.899 146.938 99.3323 146.423C111.79 145.74 121.563 140.987 128.381 132.296C133.559 125.696 136.834 117.143 138.28 106.366C144.217 109.949 148.617 114.664 151.047 120.332C155.179 129.967 155.42 145.8 142.501 158.708C131.182 170.016 117.576 174.908 97.0135 175.059C74.2042 174.89 56.9538 167.575 45.7381 153.317C35.2355 139.966 29.8077 120.682 29.6052 96C29.8077 71.3178 35.2355 52.0336 45.7381 38.6827C56.9538 24.4249 74.2039 17.11 97.0132 16.9405C119.988 17.1113 137.539 24.4614 149.184 38.788C154.894 45.8136 159.199 54.6488 162.037 64.9503L178.184 60.6422C174.744 47.9622 169.331 37.0357 161.965 27.974C147.036 9.60668 125.202 0.195148 97.0695 0H96.9569C68.8816 0.19447 47.2921 9.6418 32.7883 28.0793C19.8819 44.4864 13.2244 67.3157 13.0007 95.9325L13 96L13.0007 96.0675C13.2244 124.684 19.8819 147.514 32.7883 163.921C47.2921 182.358 68.8816 191.806 96.9569 192H97.0695C122.03 191.827 139.624 185.292 154.118 170.811C173.081 151.866 172.51 128.119 166.26 113.541C161.776 103.087 153.227 94.5962 141.537 88.9883ZM98.4405 129.507C88.0005 130.095 77.1544 125.409 76.6196 115.372C76.2232 107.93 81.9158 99.626 99.0812 98.6368C101.047 98.5234 102.976 98.468 104.871 98.468C111.106 98.468 116.939 99.0737 122.242 100.233C120.264 124.935 108.662 128.946 98.4405 129.507Z"/>
                           </svg> <span style="text-transform: capitalize; font-weight: 600; margin-left: 0.25rem;">Threads</span>`
                        : `<span style="font-size: 1.15rem; vertical-align: middle;">📱</span> <span style="text-transform: capitalize; font-weight: 600; margin-left: 0.25rem;">${post.platform}</span>`;
                    
                    viewTime.textContent = timezoneService.formatUtcToLocal(post.publish_at);
                    viewContent.textContent = post.content || '';
                    modal.style.display = 'flex';
                });
            });

            // Bind action buttons
            tbody.querySelectorAll('.btn-publish-now').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    e.target.disabled = true;
                    e.target.textContent = 'Publishing...';
                    try {
                        const success = await publishService.publishImmediately(id);
                        if (success) {
                            notificationService.success('Publication dispatched successfully!');
                            this.loadData();
                        } else {
                            throw new Error('Publication failed.');
                        }
                    } catch (err) {
                        notificationService.error(`Publishing failed: ${err.message}`);
                        e.target.disabled = false;
                        e.target.textContent = '⚡ Now';
                    }
                });
            });

            tbody.querySelectorAll('.btn-cancel-post').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (!confirm('Are you sure you want to cancel this scheduled post?')) return;
                    const id = e.target.dataset.id;
                    try {
                        await schedulerService.updateScheduledPost(id, { status: 'cancelled' });
                        notificationService.success('Schedule cancelled.');
                        this.loadData();
                    } catch (err) {
                        notificationService.error('Failed to cancel schedule.');
                    }
                });
            });

        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 2rem; color: var(--color-danger);">
                        Failed to fetch schedules database.
                    </td>
                </tr>
            `;
        }
    }
}

customElements.define('scheduled-posts-table', ScheduledPostsTable);
export default ScheduledPostsTable;
