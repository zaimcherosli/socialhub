/* SocialHub Post Content Management Service
   Coordinates RESTful CRUD operations with backend D1 endpoints. */

import { apiClient } from '../utils/api.js';

export const postService = {
    /**
     * Create a new draft or scheduled post
     * @param {object} postData { title, caption, status, visibility, scheduled_at }
     * @returns {Promise<object>} Created post description
     */
    async createPost(postData) {
        console.log('[PostService] Dispatched create request:', postData);
        return await apiClient.post('/posts', postData);
    },

    /**
     * Fetch list of all postings associated with active user session
     * @returns {Promise<Array>} List of post objects
     */
    async getPosts() {
        console.log('[PostService] Fetching posts list');
        try {
            const data = await apiClient.get('/posts');
            return data.results || [];
        } catch (error) {
            console.error('[PostService] Failed to load posts:', error.message);
            return [];
        }
    },

    /**
     * Retrieve details of a single post by ID
     * @param {number|string} id 
     * @returns {Promise<object>} Post model details
     */
    async getPost(id) {
        console.log(`[PostService] Fetching details for post ID: ${id}`);
        const data = await apiClient.get(`/posts/${id}`);
        return data.post;
    },

    /**
     * Update an existing post
     * @param {number|string} id 
     * @param {object} updates { title, caption, status, visibility, scheduled_at }
     * @returns {Promise<object>} Updated payload response
     */
    async updatePost(id, updates) {
        console.log(`[PostService] Dispatched update request for ID: ${id}`);
        return await apiClient.put(`/posts/${id}`, updates);
    },

    /**
     * Delete a post
     * @param {number|string} id 
     * @returns {Promise<boolean>} Success confirmation
     */
    async deletePost(id) {
        console.log(`[PostService] Dispatched delete request for ID: ${id}`);
        try {
            const data = await apiClient.delete(`/posts/${id}`);
            return !!data.success;
        } catch (error) {
            console.error(`[PostService] Failed to delete post ${id}:`, error.message);
            return false;
        }
    },

    /**
     * Duplicate an existing post card
     * @param {number|string} id 
     * @returns {Promise<object>} Duplicated post response
     */
    async duplicatePost(id) {
        console.log(`[PostService] Dispatched duplication request for ID: ${id}`);
        return await apiClient.post(`/posts/${id}/duplicate`);
    }
};

export default postService;
