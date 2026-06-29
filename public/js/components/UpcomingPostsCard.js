import { schedulerService } from '../services/schedulerService.js';
import { timezoneService } from '../services/timezoneService.js';

class UpcomingPostsCard extends HTMLElement {
    connectedCallback() {
        this.renderContainer();
        this.loadData();
    }

    renderContainer() {
        this.innerHTML = `
            <div class="card" style="width: 100%; height: 100%;">
                <h3 class="card-title" style="margin-bottom: 1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                    📅 Upcoming Today
                </h3>
                <div id="upcomingContainer" style="display: flex; flex-direction: column; gap: 0.75rem;">
                    <p style="font-size: 0.8125rem; color: var(--color-text-tertiary); font-style: italic;">Loading upcoming schedule...</p>
                </div>
            </div>
        `;
    }

    async loadData() {
        const container = this.querySelector('#upcomingContainer');
        try {
            const res = await schedulerService.getScheduledPosts();
            const posts = res.results || [];
            
            // Filter posts for today with status 'scheduled'
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const endOfToday = startOfToday + 86400 * 1000;
            
            const upcoming = posts.filter(post => {
                if (post.status !== 'scheduled') return false;
                const time = new Date(post.publish_at).getTime();
                return time >= now.getTime() && time <= endOfToday;
            }).slice(0, 4);

            container.innerHTML = '';

            if (upcoming.length === 0) {
                container.innerHTML = `
                    <p style="font-size: 0.8125rem; color: var(--color-text-tertiary); font-style: italic; text-align: center; padding: 1.5rem 0; margin: 0;">
                        No publications remaining for today.
                    </p>
                `;
                return;
            }

            upcoming.forEach(post => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'space-between';
                item.style.padding = '0.75rem 1rem';
                item.style.background = 'var(--color-bg-accent)';
                item.style.border = '1px solid var(--color-border)';
                item.style.borderRadius = 'var(--radius-xs)';
                
                const timeStr = new Date(post.publish_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const icon = post.platform === 'threads' ? '💬' : '📱';
                const content = post.content ? (post.content.length > 35 ? post.content.substring(0, 35) + '...' : post.content) : '(No text)';

                item.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 0.75rem; overflow: hidden; margin-right: 0.5rem;">
                        <span style="font-size: 1.25rem;">${icon}</span>
                        <div style="overflow: hidden;">
                            <p style="font-size: 0.8125rem; font-weight: 500; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-primary);">${content}</p>
                            <span style="font-size: 0.75rem; color: var(--color-text-tertiary); text-transform: capitalize;">${post.platform}</span>
                        </div>
                    </div>
                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-primary); background: var(--color-primary-light); padding: 0.2rem 0.5rem; border-radius: var(--radius-xs); white-space: nowrap;">
                        ⏰ ${timeStr}
                    </span>
                `;
                container.appendChild(item);
            });
        } catch (err) {
            container.innerHTML = `<p style="font-size: 0.8125rem; color: var(--color-danger); margin: 0;">Failed to fetch upcoming posts.</p>`;
        }
    }
}

customElements.define('upcoming-posts-card', UpcomingPostsCard);
export default UpcomingPostsCard;
