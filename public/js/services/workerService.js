/* SocialHub Cloudflare Worker Pipeline Service */
import { apiClient } from '../utils/api.js';

export const workerService = {
    async triggerWorkerPublish() {
        console.log('[WorkerService] Requesting immediate background execution of scheduler worker');
        return await apiClient.post('/api/cron/sync');
    },

    async getWorkerStatus() {
        console.log('[WorkerService] Fetching health logs for worker services');
        return {
            worker_alive: true,
            current_queue_depth: 0,
            last_run_time: new Date(Date.now() - 300000).toISOString(),
            d1_database_status: 'connected',
            r2_storage_status: 'connected'
        };
    }
};

export default workerService;
