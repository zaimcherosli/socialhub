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
            const posts = res.results || [];
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

            posts.forEach(post => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--color-border)';
                
                const timeString = timezoneService.formatUtcToLocal(post.publish_at, { timeZoneName: undefined });
                
                // Only render Threads SVG logo for threads, otherwise mobile icon
                const platformHtml = post.platform === 'threads' 
                    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" title="Threads" style="color: var(--color-text-primary); vertical-align: middle;">
                           <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-5h2v5zm-1-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
                       </svg>`
                    : `<span title="${post.platform}" style="font-size: 1.15rem; vertical-align: middle;">📱</span>`;
                
                const truncatedContent = post.content 
                    ? (post.content.length > 60 ? post.content.substring(0, 60) + '...' : post.content)
                    : '<em style="color:var(--color-text-tertiary);">No content</em>';

                tr.innerHTML = `
                    <td style="padding: 1rem;">
                        ${platformHtml}
                    </td>
                    <td style="padding: 1rem; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${truncatedContent}
                    </td>
                    <td style="padding: 1rem; color: var(--color-text-secondary); font-size: 0.8125rem; white-space: nowrap;">
                        ${timeString}
                    </td>
                    <td style="padding: 1rem;">
                        <publish-status-badge status="${post.status}"></publish-status-badge>
                    </td>
                    <td style="padding: 1rem; text-align: right;">
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
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
                        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-text-primary); vertical-align: middle;">
                               <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-5h2v5zm-1-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
                           </svg> <span style="text-transform: capitalize; font-weight: 600;">Threads</span>`
                        : `<span style="font-size: 1.15rem; vertical-align: middle;">📱</span> <span style="text-transform: capitalize; font-weight: 600;">${post.platform}</span>`;
                    
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
