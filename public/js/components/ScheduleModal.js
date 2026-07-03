class ScheduleModal extends HTMLElement {
    connectedCallback() {
        this.render();
        this.bindEvents();
    }

    render() {
        this.innerHTML = `
            <div id="scheduleModalWrapper" class="modal-overlay" style="
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(4px);
                justify-content: center;
                align-items: center;
                z-index: 1500;
            ">
                <div class="modal-card" style="
                    background: var(--color-bg-card);
                    border: 1px solid var(--color-border);
                    border-radius: var(--radius-md);
                    padding: 1.75rem;
                    width: 90%;
                    max-width: 440px;
                    box-shadow: var(--shadow-xl);
                    animation: modalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                ">
                    <h3 class="modal-title" style="margin-bottom: 0.5rem; font-family: var(--font-heading); font-size: 1.15rem; font-weight: 600;">Schedule Post</h3>
                    <p style="font-size: 0.8125rem; color: var(--color-text-secondary); margin-bottom: 1.25rem;">Select publication date, time, and target timezone.</p>
                    
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label class="form-label" for="modalScheduleTime" style="display: block; margin-bottom: 0.35rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Publish Date & Time</label>
                        <input type="datetime-local" id="modalScheduleTime" class="form-input" style="width: 100%;" />
                    </div>

                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label class="form-label" for="modalScheduleTimezone" style="display: block; margin-bottom: 0.35rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Timezone</label>
                        <select id="modalScheduleTimezone" class="form-select" style="width: 100%;">
                            <option value="UTC">UTC (GMT+0)</option>
                            <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur (GMT+8)</option>
                            <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                            <option value="America/New_York">America/New_York (EST/EDT)</option>
                            <option value="Europe/London">Europe/London (GMT/BST)</option>
                        </select>
                    </div>

                    <!-- Conditional Release settings -->
                    <div style="margin-top: 1rem; border-top: 1px dashed var(--color-border); padding-top: 1.25rem; margin-bottom: 1.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; color: var(--color-text-primary);">
                            <input type="checkbox" id="modalEnableTrigger" style="width: 15px; height: 15px;" />
                            Conditional Thread Release (Auto-Unlock)
                        </label>
                        
                        <div id="modalTriggerFields" style="display: none; margin-top: 0.85rem; gap: 0.75rem; flex-direction: column;">
                            <div style="display: flex; gap: 0.75rem;">
                                <div style="flex: 1;">
                                    <label class="form-label" for="modalTriggerType" style="display: block; margin-bottom: 0.35rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase;">Condition Type</label>
                                    <select id="modalTriggerType" class="form-select" style="width: 100%;">
                                        <option value="views">Views Count</option>
                                        <option value="likes">Likes Count</option>
                                    </select>
                                </div>
                                <div style="flex: 1;">
                                    <label class="form-label" for="modalTriggerThreshold" style="display: block; margin-bottom: 0.35rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase;">Threshold Target</label>
                                    <input type="number" id="modalTriggerThreshold" class="form-input" value="100" min="1" style="width: 100%;" />
                                </div>
                            </div>
                            <p style="font-size: 0.72rem; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
                                Slide pertama diterbitkan mengikut jadual. Slide/reply seterusnya akan dihantar secara automatik selepas slide pertama melepasi sasaran.
                            </p>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                        <button class="btn btn-secondary" id="btnCancelModal" style="padding: 0.5rem 1rem;">Cancel</button>
                        <button class="btn btn-primary" id="btnSaveModal" style="padding: 0.5rem 1rem;">Save Schedule</button>
                    </div>
                </div>
            </div>
            
            <style>
                @keyframes modalPop {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            </style>
        `;
    }

    bindEvents() {
        const overlay = this.querySelector('#scheduleModalWrapper');
        const cancelBtn = this.querySelector('#btnCancelModal');
        const saveBtn = this.querySelector('#btnSaveModal');
        const timeInput = this.querySelector('#modalScheduleTime');
        const tzSelect = this.querySelector('#modalScheduleTimezone');

        // Set default local time and timezone
        const now = new Date();
        now.setMinutes(now.getMinutes() + 15); // Default to 15 min from now
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = now.getFullYear();
        const mm = pad(now.getMonth() + 1);
        const dd = pad(now.getDate());
        const hh = pad(now.getHours());
        const min = pad(now.getMinutes());
        timeInput.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

        // Set timezone
        const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const tzOption = Array.from(tzSelect.options).find(opt => opt.value === resolvedTz);
        if (tzOption) {
            tzSelect.value = resolvedTz;
        } else {
            // Append and select
            const option = document.createElement('option');
            option.value = resolvedTz;
            option.textContent = `${resolvedTz} (Local)`;
            tzSelect.appendChild(option);
            tzSelect.value = resolvedTz;
        }

        const enableCheck = this.querySelector('#modalEnableTrigger');
        const triggerFields = this.querySelector('#modalTriggerFields');
        enableCheck.addEventListener('change', () => {
            triggerFields.style.display = enableCheck.checked ? 'flex' : 'none';
        });

        cancelBtn.addEventListener('click', () => this.hide());
        saveBtn.addEventListener('click', () => {
            const time = timeInput.value;
            const tz = tzSelect.value;
            if (!time) {
                alert('Please select a valid date and time.');
                return;
            }

            const enableTrigger = enableCheck.checked;
            const triggerType = enableTrigger ? this.querySelector('#modalTriggerType').value : null;
            const triggerThreshold = enableTrigger ? parseInt(this.querySelector('#modalTriggerThreshold').value) || 100 : null;

            this.dispatchEvent(new CustomEvent('schedule-saved', {
                detail: { 
                    time, 
                    timezone: tz,
                    triggerType,
                    triggerThreshold
                }
            }));
            this.hide();
        });
    }

    show() {
        const overlay = this.querySelector('#scheduleModalWrapper');
        if (overlay) overlay.style.display = 'flex';
    }

    hide() {
        const overlay = this.querySelector('#scheduleModalWrapper');
        if (overlay) overlay.style.display = 'none';
    }
}

customElements.define('schedule-modal', ScheduleModal);
export default ScheduleModal;
