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
                    <button class="btn btn-secondary btn-sm" id="btnReloadTable">🔄 Refresh</button>
                </div>
                <div class="table-responsive" style="overflow-x: auto; width: 100%;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--color-border); color: var(--color-text-tertiary); font-weight: 600;">
                                <th style="padding: 0.75rem 1rem;">Platform</th>
                                <th style="padding: 0.75rem 1rem;">Content</th>
                                <th style="padding: 0.75rem 1rem;">Publish At</th>
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
        `;

        this.querySelector('#btnReloadTable').addEventListener('click', () => this.loadData());
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
                
                const timeString = timezoneService.formatUtcToLocal(post.publish_at);
                const platformIcon = post.platform === 'threads' ? '💬' : '📱';
                const truncatedContent = post.content 
                    ? (post.content.length > 60 ? post.content.substring(0, 60) + '...' : post.content)
                    : '<em style="color:var(--color-text-tertiary);">No content</em>';

                tr.innerHTML = `
                    <td style="padding: 1rem; font-weight: 500;">
                        <span style="font-size: 1.1rem; margin-right: 0.35rem;">${platformIcon}</span>
                        <span style="text-transform: capitalize;">${post.platform}</span>
                    </td>
                    <td style="padding: 1rem; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${truncatedContent}
                    </td>
                    <td style="padding: 1rem; color: var(--color-text-secondary); font-size: 0.8125rem;">
                        ${timeString}
                    </td>
                    <td style="padding: 1rem;">
                        <publish-status-badge status="${post.status}"></publish-status-badge>
                    </td>
                    <td style="padding: 1rem; text-align: right;">
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                            ${post.status === 'scheduled' || post.status === 'failed' ? `
                                <button class="btn btn-secondary btn-sm btn-publish-now" data-id="${post.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">⚡ Now</button>
                                <button class="btn btn-danger btn-sm btn-cancel-post" data-id="${post.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Cancel</button>
                            ` : ''}
                        </div>
                    </td>
                `;

                tbody.appendChild(tr);
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
