/* Client stub for background cron tasks trigger (if manually requested) */
import { apiClient } from '../utils/api.js';

export const cronService = {
    async triggerCronSync() {
        return await apiClient.post('/cron/sync');
    }
};

export default cronService;
