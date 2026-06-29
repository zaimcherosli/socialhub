/* SocialHub Queue Job Lock Manager Service
   Implements verification checks to prevent concurrent worker execution race conditions. */

export const jobService = {
    /**
     * Determine if a queue job has an active worker lock
     * @param {object} queueItem 
     * @returns {boolean}
     */
    isJobLocked(queueItem) {
        if (!queueItem.worker_id || queueItem.status !== 'publishing') {
            return false;
        }

        // Verify lock lease expiry (locks expire after 15 minutes to avoid deadlocks)
        try {
            const updatedAtTime = new Date(queueItem.updated_at).getTime();
            if (isNaN(updatedAtTime)) return false;
            
            const lockLeaseDuration = 15 * 60 * 1000; // 15 Minutes
            return (Date.now() - updatedAtTime) < lockLeaseDuration;
        } catch (e) {
            return false;
        }
    },

    /**
     * Check if a job is ready to be parsed by the engine (due and unlocked)
     * @param {object} queueItem 
     * @returns {boolean}
     */
    isReadyForDispatch(queueItem) {
        const statusValid = ['queued', 'retrying'].includes(queueItem.status);
        if (!statusValid) return false;

        const scheduledTime = new Date(queueItem.scheduled_at).getTime();
        if (isNaN(scheduledTime)) return false;

        const isDue = scheduledTime <= Date.now();
        const isLocked = this.isJobLocked(queueItem);

        return isDue && !isLocked;
    }
};

export default jobService;
