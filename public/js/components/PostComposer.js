import { socialService } from '../services/socialService.js';
import { validationService } from '../services/validationService.js';

class PostComposer extends HTMLElement {
    async connectedCallback() {
        this.render();
        this.bindEvents();
        await this.loadConnectedChannels();
    }

    render() {
        this.innerHTML = `
            <div class="composer-grid">
                <!-- Left Column: Form -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1.25rem;">
                    <div class="form-group">
                        <label class="form-label" for="composerTitle">Post Title</label>
                        <input type="text" id="composerTitle" class="form-input" placeholder="Give your post a title..." style="width: 100%;" />
                    </div>

                    <div class="form-group">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                            <label class="form-label" for="composerContent" style="margin: 0;">Caption Content</label>
                            <span id="composerLimitWarning" style="color: var(--color-danger); font-size: 0.75rem; font-weight: 600; display: none;"></span>
                        </div>
                        <textarea id="composerContent" class="form-input" rows="6" placeholder="What would you like to share?" style="width: 100%; resize: vertical;"></textarea>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Target Channels</label>
                        <div id="composerChannelsContainer" style="
                            display: flex;
                            flex-direction: column;
                            gap: 0.5rem;
                            margin-top: 0.5rem;
                            background: var(--color-bg-accent);
                            padding: 0.75rem 1rem;
                            border-radius: var(--radius-xs);
                            border: 1px solid var(--color-border);
                        ">
                            <p style="font-size: 0.75rem; color: var(--color-text-tertiary); font-style: italic; margin: 0;">Loading connected channels...</p>
                        </div>
                    </div>

                    <div class="composer-actions-row">
                        <button class="btn btn-secondary" id="composerBtnPublish" style="flex: 1; justify-content: center; height: 42px;">⚡ Publish Now</button>
                        <button class="btn btn-primary" id="composerBtnSchedule" style="flex: 1; justify-content: center; height: 42px;">📅 Schedule Post</button>
                    </div>
                </div>

                <!-- Right Column: Live Preview -->
                <div class="card" style="align-self: start; position: sticky; top: 2rem;">
                    <h3 class="card-title" style="margin-bottom: 0.5rem; font-size: 1rem; font-weight: 600;">Feed Preview</h3>
                    <p class="card-subtitle" style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-bottom: 1.25rem;">Threads Rendering Simulation</p>
                    
                    <div style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1rem; background: var(--color-bg-accent);">
                        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                            <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--color-primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.8125rem;">
                                ME
                            </div>
                            <div>
                                <span style="font-weight: 600; font-size: 0.875rem;">Connected User</span>
                                <span style="color: var(--color-text-tertiary); font-size: 0.75rem; display: block;">Simulated View</span>
                            </div>
                        </div>
                        <p id="previewText" style="font-size: 0.875rem; color: var(--color-text-primary); line-height: 1.4; word-break: break-word; margin: 0; min-height: 24px;">Your preview will appear here...</p>
                    </div>
                </div>
            </div>
            <schedule-modal id="composerScheduleModal"></schedule-modal>
            
            <style>
                .composer-grid {
                    display: grid;
                    grid-template-columns: 3fr 2fr;
                    gap: 2rem;
                    width: 100%;
                }
                
                @media (max-width: 992px) {
                    .composer-grid {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                    }
                    
                    .composer-grid > .card {
                        position: static !important;
                    }
                }
            </style>
        `;
    }

    bindEvents() {
        const contentArea = this.querySelector('#composerContent');
        const previewText = this.querySelector('#previewText');
        const limitWarning = this.querySelector('#composerLimitWarning');
        const btnPublish = this.querySelector('#composerBtnPublish');
        const btnSchedule = this.querySelector('#composerBtnSchedule');
        const modal = this.querySelector('#composerScheduleModal');

        // Live preview sync and limits
        contentArea.addEventListener('input', () => {
            const val = contentArea.value;
            previewText.textContent = val || 'Your preview will appear here...';
            
            // Check character limits (Threads limit: 500 chars)
            const len = val.length;
            if (len > 500) {
                contentArea.style.borderColor = 'var(--color-danger)';
                limitWarning.textContent = `Threads limit exceeded! (${len}/500)`;
                limitWarning.style.display = 'inline';
            } else {
                contentArea.style.borderColor = '';
                limitWarning.style.display = 'none';
            }
        });

        // Trigger Publish Now event
        btnPublish.addEventListener('click', () => {
            const state = this.getComposerState();
            if (!this.validateState(state)) return;
            
            this.dispatchEvent(new CustomEvent('publish-now', {
                detail: state
            }));
        });

        // Trigger Schedule Modal
        btnSchedule.addEventListener('click', () => {
            const state = this.getComposerState();
            if (!this.validateState(state)) return;
            modal.show();
        });

        // Handle Schedule saved event
        modal.addEventListener('schedule-saved', (e) => {
            const state = this.getComposerState();
            const { time, timezone } = e.detail;
            
            this.dispatchEvent(new CustomEvent('schedule', {
                detail: { ...state, publish_at: time, timezone }
            }));
        });
    }

    getComposerState() {
        const title = this.querySelector('#composerTitle').value;
        const content = this.querySelector('#composerContent').value;
        
        const checkedBoxes = Array.from(this.querySelectorAll('.composer-channel-checkbox:checked'));
        const targets = checkedBoxes.map(cb => ({
            platform: cb.value,
            accountId: cb.dataset.accountId
        }));

        return { title, content, targets };
    }

    validateState(state) {
        if (!state.content || !state.content.trim()) {
            alert('Please write some content first.');
            return false;
        }
        if (state.targets.length === 0) {
            alert('Please select at least one publishing channel.');
            return false;
        }
        if (state.content.length > 5000) {
            alert('Your content exceeds the maximum thread limit of 5000 characters.');
            return false;
        }
        return true;
    }

    async loadConnectedChannels() {
        const container = this.querySelector('#composerChannelsContainer');
        try {
            const accounts = await socialService.getAccounts();
            container.innerHTML = '';
            
            const active = accounts.filter(acc => acc.status === 'active');
            if (active.length === 0) {
                container.innerHTML = `
                    <p style="font-size: 0.75rem; color: var(--color-text-tertiary); font-style: italic; margin: 0;">
                        No accounts connected. <a href="accounts.html" style="color:var(--color-primary); font-weight:500;">Link accounts here</a>
                    </p>
                `;
                return;
            }

            active.forEach(acc => {
                const label = document.createElement('label');
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.gap = '0.5rem';
                label.style.fontSize = '0.875rem';
                label.style.cursor = 'pointer';
                label.style.color = 'var(--color-text-secondary)';
                
                label.innerHTML = `
                    <input type="checkbox" class="composer-channel-checkbox" value="${acc.platform}" data-account-id="${acc.id}" checked />
                    <span style="text-transform: capitalize; font-weight: 500;">${acc.platform}</span>
                    <span style="font-size: 0.75rem; color: var(--color-text-tertiary);">(${acc.account_name})</span>
                `;
                container.appendChild(label);
            });
        } catch (err) {
            container.innerHTML = `<p style="font-size: 0.75rem; color: var(--color-danger); margin: 0;">Failed to load connected platforms.</p>`;
        }
    }
}

customElements.define('post-composer', PostComposer);
export default PostComposer;
