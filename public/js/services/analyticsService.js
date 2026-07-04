/* SocialHub Analytics Service — fetches post performance + follower growth data */
import { apiClient } from '../utils/api.js';

export const analyticsService = {
    async getAnalytics(days = 30) {
        return await apiClient.get(`/api/analytics?days=${days}`);
    }
};

export default analyticsService;
