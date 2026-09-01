/* Reusable cross-platform post scheduler service */
import { apiClient } from '../utils/api.js';

export const schedulerService = {
    async getScheduledPosts() {
        return await apiClient.get('/scheduled-posts');
    },

    async getScheduledPost(id) {
        const data = await apiClient.get(`/scheduled-posts/${id}`);
        return data.post;
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

    async publishScheduledPost(id) {
        return await apiClient.post(`/scheduled-posts/${id}/publish`);
    },

    async getScheduleStatusSummary() {
        return await apiClient.get('/scheduled-posts/summary');
    },

    async bulkDelete(ids) {
        return Promise.all(ids.map(id => this.deleteScheduledPost(id)));
    },

    async bulkUpdate(ids, data) {
        return Promise.all(ids.map(id => this.updateScheduledPost(id, data)));
    }
};

export default schedulerService;
