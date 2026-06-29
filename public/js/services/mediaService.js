/* SocialHub Media Assets Manager Service
   Interacts with Worker D1 REST endpoints to manage user files and favorite metadata toggles. */

import { apiClient } from '../utils/api.js';

export const mediaService = {
    /**
     * Fetch list of user's uploaded media files
     * @returns {Promise<Array>} List of media objects
     */
    async getMedia() {
        console.log('[MediaService] Fetching media gallery list');
        try {
            const data = await apiClient.get('/media');
            return data.results || [];
        } catch (error) {
            console.error('[MediaService] Failed to load media:', error.message);
            return [];
        }
    },

    /**
     * Rename an asset filename
     * @param {number|string} id 
     * @param {string} newFilename 
     * @returns {Promise<object>} Updated media object
     */
    async renameMedia(id, newFilename) {
        console.log(`[MediaService] Requesting rename for ID: ${id} to: ${newFilename}`);
        const data = await apiClient.put(`/media/${id}`, { filename: newFilename });
        return data.media;
    },

    /**
     * Toggle favorite status on an asset
     * @param {number|string} id 
     * @param {boolean} isFavorite 
     * @returns {Promise<object>} Updated media object
     */
    async toggleFavorite(id, isFavorite) {
        console.log(`[MediaService] Toggling favorite status for ID: ${id} to: ${isFavorite}`);
        const data = await apiClient.put(`/media/${id}`, { is_favorite: isFavorite });
        return data.media;
    },

    /**
     * Delete an asset
     * @param {number|string} id 
     * @returns {Promise<boolean>} Success confirmation
     */
    async deleteMedia(id) {
        console.log(`[MediaService] Requesting delete for ID: ${id}`);
        try {
            const data = await apiClient.delete(`/media/${id}`);
            return !!data.success;
        } catch (error) {
            console.error(`[MediaService] Failed to delete media ${id}:`, error.message);
            return false;
        }
    },

    /**
     * Fetch list of media attached to a specific post
     * @param {number|string} postId 
     * @returns {Promise<Array>} List of media objects
     */
    async getPostMedia(postId) {
        console.log(`[MediaService] Fetching media attachments for post ID: ${postId}`);
        try {
            const data = await apiClient.get(`/posts/${postId}/media`);
            return data.results || [];
        } catch (error) {
            console.error(`[MediaService] Failed to load post media for ID ${postId}:`, error.message);
            return [];
        }
    },

    /**
     * Attach an asset to a post
     * @param {number|string} postId 
     * @param {number|string} mediaId 
     * @returns {Promise<boolean>} Success status
     */
    async attachMediaToPost(postId, mediaId) {
        console.log(`[MediaService] Linking media ID: ${mediaId} to post ID: ${postId}`);
        try {
            const data = await apiClient.post(`/posts/${postId}/media`, { media_id: mediaId });
            return !!data.success;
        } catch (error) {
            console.error(`[MediaService] Failed to attach media:`, error.message);
            return false;
        }
    },

    /**
     * Detach an asset from a post
     * @param {number|string} postId 
     * @param {number|string} mediaId 
     * @returns {Promise<boolean>} Success status
     */
    async detachMediaFromPost(postId, mediaId) {
        console.log(`[MediaService] Unlinking media ID: ${mediaId} from post ID: ${postId}`);
        try {
            const data = await apiClient.delete(`/posts/${postId}/media/${mediaId}`);
            return !!data.success;
        } catch (error) {
            console.error(`[MediaService] Failed to detach media:`, error.message);
            return false;
        }
    }
};

export default mediaService;
