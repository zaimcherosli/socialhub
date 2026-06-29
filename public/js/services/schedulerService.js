/* Reusable cross-platform post scheduler service */
import { apiClient } from '../utils/api.js';

export const schedulerService = {
    async getScheduledPosts() {
        return await apiClient.get('/scheduled-posts');
    },

    async createScheduledPost(postData) {
        return await apiClient.post('/scheduled-posts', postData);
    },

    async updateScheduledPost(id, postData) {
        return await apiClient.put(`/scheduled-posts/${id}`, postData);
    },

    async deleteScheduledPost(id) {
        return await apiClient.delete(`/scheduled-posts/${id}`);
    },

    async getScheduleStatusSummary() {
        return await apiClient.get('/scheduled-posts/summary');
    }
};

export default schedulerService;
