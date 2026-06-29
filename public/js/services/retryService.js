/* SocialHub Exponential Backoff Retry Policy Service
   Calculates rescheduled trigger dates for failed posting jobs based on attempt counts. */

const RETRY_BACKOFF_INTERVALS_MINUTES = [1, 5, 15];
const MAX_RETRY_LIMIT = 3;

export const retryService = {
    /**
     * Compute next UTC timestamp to retry a failed job
     * @param {number} attemptCount Current failure counts
     * @returns {Date}
     */
    calculateNextRetryDate(attemptCount) {
        const index = Math.min(attemptCount - 1, RETRY_BACKOFF_INTERVALS_MINUTES.length - 1);
        const backoffMinutes = RETRY_BACKOFF_INTERVALS_MINUTES[index >= 0 ? index : 0];
        
        return new Date(Date.now() + (backoffMinutes * 60 * 1000));
    },

    /**
     * Determine if a failed job has reached maximum limits
     * @param {number} attemptCount 
     * @returns {boolean}
     */
    hasExceededMaxAttempts(attemptCount) {
        return attemptCount >= MAX_RETRY_LIMIT;
    },

    /**
     * Get maximum retry configurations count
     * @returns {number}
     */
    getMaxRetries() {
        return MAX_RETRY_LIMIT;
    }
};

export default retryService;
