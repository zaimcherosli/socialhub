/* SocialHub Schedule Engine Manager Service
   Interacts with Worker D1 REST endpoints to manage queue schedule objects. */

import { apiClient } from '../utils/api.js';

export const scheduleService = {
    /**
     * Fetch list of scheduled queue timelines
     * @returns {Promise<Array>} List of schedule objects
     */
    async getSchedules() {
        console.log('[ScheduleService] Fetching active schedules');
        try {
            const data = await apiClient.get('/queue');
            return data.results || [];
        } catch (error) {
            console.error('[ScheduleService] Failed to load schedules:', error.message);
            return [];
        }
    },

    /**
     * Queue a post for scheduling
     * @param {number|string} postId 
     * @param {string} platform Platform key (threads, facebook, etc.)
     * @param {string} scheduledAt ISO8601 UTC timestamp
     * @param {string} timezone User's local timezone name (e.g. 'Asia/Kuala_Lumpur')
     * @returns {Promise<object>} Created schedule details
     */
    async createSchedule(postId, platform, scheduledAt, timezone = 'UTC') {
        console.log(`[ScheduleService] Creating queue item for post ${postId} on ${platform} at ${scheduledAt}`);
        return await apiClient.post('/queue', {
            post_id: parseInt(postId),
            platform,
            scheduled_at: scheduledAt,
            timezone
        });
    },

    /**
     * Modify an existing schedule
     * @param {number|string} id 
     * @param {object} updates { scheduled_at, timezone, status }
     * @returns {Promise<object>} Updated payload response
     */
    async updateSchedule(id, updates) {
        console.log(`[ScheduleService] Updating schedule ID: ${id}`);
        return await apiClient.put(`/queue/${id}`, updates);
    },

    /**
     * Cancel and remove a schedule
     * @param {number|string} id 
     * @returns {Promise<boolean>} Success confirmation
     */
    async cancelSchedule(id) {
        console.log(`[ScheduleService] Cancelling schedule ID: ${id}`);
        try {
            const data = await apiClient.delete(`/queue/${id}`);
            return !!data.success;
        } catch (error) {
            console.error(`[ScheduleService] Failed to cancel schedule ${id}:`, error.message);
            return false;
        }
    }
};

export default scheduleService;
