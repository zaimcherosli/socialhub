/* SocialHub User Profile Management Service
   Fetches authenticated user context from the API backend. */

import { apiClient } from '../utils/api.js';

export const userService = {
    /**
     * Fetch authenticated user details
     * @returns {Promise<object>} User model from D1
     */
    async getProfile() {
        try {
            const data = await apiClient.get('/users/me');
            return data.user;
        } catch (error) {
            console.error('[UserService] Failed to retrieve user profile:', error.message);
            throw error;
        }
    }
};

export default userService;
