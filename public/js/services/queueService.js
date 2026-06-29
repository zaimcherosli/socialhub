/* SocialHub Queue Operations Manager Service
   Dispatches queue execution states such as manual publish triggers, retries, and bulk cancellations. */

import { apiClient } from '../utils/api.js';

export const queueService = {
    /**
     * Trigger immediate manual publish of a queued post
     * @param {number|string} id Queue ID
     * @returns {Promise<boolean>} Success confirmation
     */
    async manualPublish(id) {
        console.log(`[QueueService] Dispatching manual publish request for queue ID: ${id}`);
        try {
            const data = await apiClient.post(`/queue/${id}/publish`);
            return !!data.success;
        } catch (error) {
            console.error(`[QueueService] Failed to manually publish ID ${id}:`, error.message);
            alert(`Publishing failed: ${error.message}`);
            return false;
        }
    },

    /**
     * Resubmit a failed job to the queued state
     * @param {number|string} id Queue ID
     * @returns {Promise<boolean>} Success confirmation
     */
    async retryJob(id) {
        console.log(`[QueueService] Dispatching retry request for queue ID: ${id}`);
        try {
            const data = await apiClient.post(`/queue/${id}/retry`);
            return !!data.success;
        } catch (error) {
            console.error(`[QueueService] Failed to retry ID ${id}:`, error.message);
            return false;
        }
    },

    /**
     * Cancel and delete multiple queue items in bulk
     * @param {Array<number|string>} ids Array of Queue IDs
     * @returns {Promise<boolean>} Success confirmation
     */
    async bulkCancel(ids) {
        if (!ids || ids.length === 0) return false;
        console.log(`[QueueService] Dispatching bulk cancel for IDs:`, ids);
        try {
            const data = await apiClient.post('/queue/bulk-delete', { ids });
            return !!data.success;
        } catch (error) {
            console.error('[QueueService] Bulk cancellation failed:', error.message);
            return false;
        }
    }
};

export default queueService;
