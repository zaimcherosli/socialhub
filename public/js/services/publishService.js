/* Client stub for publish triggers */
import { apiClient } from '../utils/api.js';

export const publishService = {
    async publishImmediately(scheduledPostId) {
        return await apiClient.post(`/scheduled-posts/${scheduledPostId}/publish`);
    }
};

export default publishService;
