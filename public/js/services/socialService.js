/* SocialHub Third-Party Integration Manager Service
   Handles retrieval, disconnection, and reconnection workflows for social accounts. */

import { apiClient } from '../utils/api.js';

export const socialService = {
    /**
     * Get OAuth connection redirect URL for a specific platform
     * @param {string} platform Platform key (threads, facebook, instagram, linkedin, tiktok, twitter)
     * @returns {Promise<object>} Auth redirection URL object
     */
    async connectAccount(platform) {
        console.log(`[SocialService] Requesting OAuth redirect URL for: ${platform}`);
        return await apiClient.get(`/oauth/connect?platform=${platform}`);
    },

    /**
     * Fetch list of connected accounts metadata for the active user
     * @returns {Promise<Array>} List of account objects (tokens omitted)
     */
    async getAccounts() {
        console.log('[SocialService] Querying connected channels metadata');
        try {
            const data = await apiClient.get('/social/accounts');
            return data.accounts || [];
        } catch (error) {
            console.error('[SocialService] Failed to load accounts:', error.message);
            return [];
        }
    },

    /**
     * Sever authentication link to a social media account
     * @param {number|string} accountId 
     * @returns {Promise<boolean>} Success status
     */
    async disconnectAccount(accountId) {
        console.log(`[SocialService] Severing channel ID: ${accountId}`);
        try {
            const data = await apiClient.delete(`/social/accounts/${accountId}`);
            return !!data.success;
        } catch (error) {
            console.error(`[SocialService] Failed to disconnect account ${accountId}:`, error.message);
            return false;
        }
    },

    /**
     * Trigger token reconnection flow
     * @param {number|string} accountId 
     * @returns {Promise<object>} Redirect URL response
     */
    async reconnectAccount(accountId) {
        console.log(`[SocialService] Requesting reconnection redirect for account: ${accountId}`);
        return await apiClient.post(`/social/accounts/${accountId}`);
    }
};

export default socialService;
