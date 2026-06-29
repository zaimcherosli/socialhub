/* SocialHub Publishing Audit Logs Service
   Queries execution histories, durations, error payloads, and platform targets. */

import { apiClient } from '../utils/api.js';

export const publishLogService = {
    /**
     * Fetch list of publishing audit logs
     * @returns {Promise<Array>} List of log objects
     */
    async getLogs() {
        console.log('[PublishLogService] Querying execution history logs');
        try {
            const data = await apiClient.get('/publish/logs');
            return data.results || [];
        } catch (error) {
            console.error('[PublishLogService] Failed to load audit logs:', error.message);
            return [];
        }
    }
};

export default publishLogService;
