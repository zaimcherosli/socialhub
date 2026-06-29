/* SocialHub Autosave & Local Backup Draft Service
   Saves local editor buffer backups to protect users from browser crashes or connection drops. */

const BACKUP_PREFIX = 'socialhub_draft_backup_';
let autosaveInterval = null;

export const draftService = {
    /**
     * Start background auto-saving every 30 seconds
     * @param {string|number} postId Post Identifier (use 'new' for new drafts)
     * @param {Function} getDraftState Retrieve current title, caption, visibility state object
     * @param {Function} onSaveComplete Callback triggered when autosave finishes
     */
    startAutosave(postId, getDraftState, onSaveComplete = null) {
        this.stopAutosave();
        
        console.log(`[DraftService] Initiating autosave daemon for post ID: ${postId}`);
        
        autosaveInterval = setInterval(() => {
            const state = getDraftState();
            if (!state || (!state.title && !state.caption)) return; // Skip saving empty forms
            
            const backupPayload = {
                state,
                timestamp: Date.now()
            };
            
            localStorage.setItem(`${BACKUP_PREFIX}${postId}`, JSON.stringify(backupPayload));
            console.log(`[DraftService] Autosaved local buffer for ID: ${postId}`);
            
            if (onSaveComplete) {
                onSaveComplete(backupPayload.timestamp);
            }
        }, 30000); // 30 seconds interval
    },

    /**
     * Terminate active autosave timers
     */
    stopAutosave() {
        if (autosaveInterval) {
            clearInterval(autosaveInterval);
            autosaveInterval = null;
            console.log('[DraftService] Autosave daemon terminated');
        }
    },

    /**
     * Check if a newer local backup is available in the browser storage
     * @param {string|number} postId 
     * @param {string} dbUpdatedAt ISO string of last database update
     * @returns {boolean}
     */
    hasNewerBackup(postId, dbUpdatedAt = null) {
        const backupRaw = localStorage.getItem(`${BACKUP_PREFIX}${postId}`);
        if (!backupRaw) return false;
        
        try {
            const backup = JSON.parse(backupRaw);
            if (!dbUpdatedAt) return true; // New draft, backup always wins
            
            const dbTime = new Date(dbUpdatedAt).getTime();
            return backup.timestamp > dbTime;
        } catch (e) {
            return false;
        }
    },

    /**
     * Retrieve backing state details
     * @param {string|number} postId 
     * @returns {object|null}
     */
    getBackup(postId) {
        const backupRaw = localStorage.getItem(`${BACKUP_PREFIX}${postId}`);
        if (!backupRaw) return null;
        
        try {
            const backup = JSON.parse(backupRaw);
            return backup.state;
        } catch (e) {
            return null;
        }
    },

    /**
     * Discard backup states
     * @param {string|number} postId 
     */
    clearBackup(postId) {
        localStorage.removeItem(`${BACKUP_PREFIX}${postId}`);
        console.log(`[DraftService] Purged local buffer for ID: ${postId}`);
    }
};

export default draftService;
