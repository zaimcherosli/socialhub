import { socialService } from '../services/socialService.js';
import { validationService } from '../services/validationService.js';
import { apiClient } from '../utils/api.js';

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
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                            <label class="form-label" for="composerMediaUrl" style="margin: 0;">Media / Image Link</label>
                            <div style="display: inline-flex; align-items: center; gap: 0.35rem;">
                                <select id="composerAiImageQuality" style="font-size: 0.72rem; padding: 0.25rem 0.4rem; border-radius: var(--radius-xs); border: 1px solid var(--color-border); background: var(--color-bg-primary); color: var(--color-text-primary); font-weight: 600; cursor: pointer;" title="Pilih kualiti gambar AI">
                                    <option value="low">⚡ Low Quality</option>
                                    <option value="medium" selected>⚖️ Medium</option>
                                    <option value="high">✨ High Quality (HD)</option>
                                </select>
                                <button type="button" class="btn btn-secondary" id="btnComposerGenerateAiImage" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; border-radius: var(--radius-xs); display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600;">
                                    ✨ Generate AI Image
                                </button>
                            </div>
                        </div>
                        <input type="url" id="composerMediaUrl" class="form-input" placeholder="Paste photo link or click 'Generate AI Image' button above" style="width: 100%;" />
                        
                        <!-- Visual Image Preview Box -->
                        <div id="composerImagePreviewBox" style="display: none; margin-top: 0.75rem; position: relative; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--color-border); background: var(--color-bg-accent); text-align: center; padding: 0.5rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0 0.25rem;">
                                <span style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary); display: flex; align-items: center; gap: 0.35rem;">
                                    🖼️ Image Visual Preview
                                </span>
                                <button type="button" id="btnRemoveComposerAiImage" style="background: rgba(239, 68, 68, 0.15); color: var(--color-danger); border: 1px solid var(--color-danger); border-radius: 4px; padding: 0.15rem 0.5rem; font-size: 0.72rem; font-weight: 600; cursor: pointer;">
                                    🗑️ Buang Gambar
                                </button>
                            </div>
                            <img id="composerImagePreviewTag" src="" alt="AI Generated Preview" style="max-width: 100%; max-height: 260px; object-fit: contain; border-radius: 6px; border: 1px solid var(--color-border); display: block; margin: 0 auto; background: #000;" />
                            <div id="composerImageSourceBadge" style="display: none; margin-top: 0.5rem; font-size: 0.72rem; font-weight: 600; color: #a78bfa; background: rgba(124, 58, 237, 0.12); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 20px; padding: 0.25rem 0.75rem; align-items: center; justify-content: center; gap: 0.35rem;">
                                ✨ Image created by OpenAI (gpt-image-2)
                            </div>
                        </div>
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
                        <div id="feedPreviewImageContainer" style="display: none; margin-top: 0.75rem;">
                            <img id="feedPreviewImageTag" src="" style="width: 100%; border-radius: var(--radius-xs); border: 1px solid var(--color-border); max-height: 280px; object-fit: cover;" />
                        </div>
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

        // Visual Image Preview elements
        const composerPreviewBox = this.querySelector('#composerImagePreviewBox');
        const composerPreviewTag = this.querySelector('#composerImagePreviewTag');
        const feedImageContainer = this.querySelector('#feedPreviewImageContainer');
        const feedImageTag = this.querySelector('#feedPreviewImageTag');
        const btnRemoveComposerImg = this.querySelector('#btnRemoveComposerAiImage');

        const updateComposerPreview = () => {
            const url = mediaInput ? mediaInput.value.trim() : '';
            if (url) {
                if (composerPreviewTag) composerPreviewTag.src = url;
                if (composerPreviewBox) composerPreviewBox.style.display = 'block';
                if (feedImageTag) feedImageTag.src = url;
                if (feedImageContainer) feedImageContainer.style.display = 'block';
            } else {
                if (composerPreviewTag) composerPreviewTag.src = '';
                if (composerPreviewBox) composerPreviewBox.style.display = 'none';
                if (feedImageTag) feedImageTag.src = '';
                if (feedImageContainer) feedImageContainer.style.display = 'none';
            }
        };

        if (mediaInput) {
            mediaInput.addEventListener('input', updateComposerPreview);
            mediaInput.addEventListener('change', updateComposerPreview);
        }

        if (btnRemoveComposerImg) {
            btnRemoveComposerImg.addEventListener('click', () => {
                if (mediaInput) mediaInput.value = '';
                updateComposerPreview();
            });
        }

        if (btnGenAiImage) {
            btnGenAiImage.addEventListener('click', async (e) => {
                e.preventDefault();
                const captionText = contentArea.value.trim() || titleInput.value.trim();
                if (!captionText) {
                    if (window.notificationService) {
                        window.notificationService.error('Sila tulis kapsyen atau tajuk pos terlebih dahulu.');
                    } else {
                        alert('Sila tulis kapsyen atau tajuk pos terlebih dahulu.');
                    }
                    return;
                }

                btnGenAiImage.disabled = true;
                const origBtnText = btnGenAiImage.innerHTML;
                btnGenAiImage.innerHTML = `⏳ Generating AI Image...`;

                try {
                    const selectedQuality = document.getElementById('composerAiImageQuality')?.value || 'medium';
                    const data = await apiClient.post('/ai/generate-image', { caption: captionText, quality: selectedQuality });
                    if (data && (data.image_url || data.success)) {
                        const imgUrl = data.image_url || data.media?.thumbnail;
                        if (imgUrl) {
                            mediaInput.value = imgUrl;
                            updateComposerPreview();
                            let sourceMsg = '✨ Gambar AI berjaya dijana!';
                            let badgeText = '✨ Image created by OpenAI (gpt-image-2)';
                            if (data.source === 'openai-gpt-image-2') {
                                sourceMsg = '✨ Gambar AI (OpenAI gpt-image-2) berjaya dijana!';
                                badgeText = '✨ Image created by OpenAI (gpt-image-2)';
                            } else if (data.source === 'cloudflare-sdxl') {
                                sourceMsg = '⚠️ OpenAI tergendala / tiada kredit. Gambar AI dijana menggunakan Fallback: Cloudflare Workers AI (Stable Diffusion)';
                                badgeText = '⚡ Image created by Cloudflare Workers AI (Stable Diffusion XL)';
                            } else if (data.source === 'unsplash-fallback') {
                                sourceMsg = '⚠️ Enjin AI tergendala. Gambar diambil daripada Fallback: Unsplash Stock';
                                badgeText = '🖼️ Image from Unsplash Stock Library';
                            }

                            const composerBadge = document.getElementById('composerImageSourceBadge');
                            if (composerBadge) {
                                composerBadge.innerHTML = badgeText;
                                composerBadge.style.display = 'inline-flex';
                            }

                            if (window.notificationService) {
                                window.notificationService.success(sourceMsg);
                            }
                        } else {
                            throw new Error('Gagal mendapatkan URL gambar AI.');
                        }
                    } else {
                        throw new Error(data?.error || data?.message || 'Gagal menjana gambar AI');
                    }
                } catch (err) {
                    if (window.notificationService) {
                        window.notificationService.error(`AI Image generation error: ${err.message}`);
                    } else {
                        alert(`AI Image generation error: ${err.message}`);
                    }
                } finally {
                    btnGenAiImage.disabled = false;
                    btnGenAiImage.innerHTML = origBtnText;
                }
            });
        }

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
            const { time, timezone, triggerType, triggerThreshold } = e.detail;
            
            this.dispatchEvent(new CustomEvent('schedule', {
                detail: { ...state, publish_at: time, timezone, triggerType, triggerThreshold }
            }));
        });
    }

    setLoading(loading, text = '') {
        const btnPublish = this.querySelector('#composerBtnPublish');
        const btnSchedule = this.querySelector('#composerBtnSchedule');
        if (loading) {
            if (btnPublish) {
                btnPublish.disabled = true;
                btnPublish.dataset.origText = btnPublish.innerHTML;
                btnPublish.innerHTML = `⏳ ${text || 'Publishing...'}`;
            }
            if (btnSchedule) btnSchedule.disabled = true;
        } else {
            if (btnPublish) {
                btnPublish.disabled = false;
                btnPublish.innerHTML = btnPublish.dataset.origText || '⚡ Publish Now';
            }
            if (btnSchedule) btnSchedule.disabled = false;
        }
    }

    getComposerState() {
        const title = this.querySelector('#composerTitle').value;
        const rawContent = this.querySelector('#composerContent').value;
        const mediaUrl = this.querySelector('#composerMediaUrl')?.value?.trim();
        
        let content = rawContent;
        if (mediaUrl && !rawContent.includes(mediaUrl)) {
            content = `${rawContent}\n\n📷 ${mediaUrl}`;
        }
        
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
