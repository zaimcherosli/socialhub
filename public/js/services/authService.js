/* SocialHub Authentication Service
   Coordinates registration, login, logout, and session retrieval with backend API endpoints. */

import { apiClient } from '../utils/api.js';
import { sessionService } from './sessionService.js';

export const authService = {
    /**
     * Authenticate user with credentials and persist session
     * @param {string} email 
     * @param {string} password 
     * @param {boolean} rememberMe 
     * @returns {Promise<object>} Response payload containing token and user
     */
    async login(email, password, rememberMe = false) {
        console.log(`[AuthService] Attempting credentials verification for: ${email}`);
        const data = await apiClient.post('/auth/login', { email, password, rememberMe });
        if (data && data.token) {
            sessionService.saveToken(data.token, rememberMe);
        }
        return data;
    },

    /**
     * Authenticate user via Google OAuth ID token credential
     * @param {string} credential Google JWT ID Token
     * @param {boolean} rememberMe 
     * @returns {Promise<object>} Response payload containing token and user
     */
    async loginWithGoogle(credential, rememberMe = true) {
        console.log('[AuthService] Verifying Google OAuth credential token');
        const data = await apiClient.post('/auth/google', { credential, rememberMe });
        if (data && data.token) {
            sessionService.saveToken(data.token, rememberMe);
        }
        return data;
    },

    /**
     * Get Google OAuth Client ID configured for this instance
     * @returns {Promise<string>} Client ID string
     */
    async getGoogleClientId() {
        try {
            const data = await apiClient.get('/auth/google/client-id');
            return data?.clientId || '';
        } catch (_) {
            return '';
        }
    },

    /**
     * Register a new user account
     * @param {string} name 
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<object>} Response details
     */
    async register(name, email, password) {
        console.log(`[AuthService] Submitting registration for: ${email}`);
        return await apiClient.post('/auth/register', { name, email, password });
    },

    /**
     * Terminate active session and clear client credentials
     */
    async logout() {
        console.log('[AuthService] Initiating logout request');
        try {
            await apiClient.post('/auth/logout');
        } catch (error) {
            console.warn('[AuthService] Backend session termination failed or timed out:', error.message);
        } finally {
            sessionService.clearToken();
            window.location.replace('login.html');
        }
    },

    /**
     * Query currently active profile session context
     * @returns {Promise<object|null>} Active user metadata
     */
    async getSession() {
        if (!sessionService.isAuthenticated()) return null;
        try {
            const data = await apiClient.get('/users/me');
            return data.user;
        } catch (error) {
            console.error('[AuthService] Active session validation check failed:', error.message);
            sessionService.clearToken();
            return null;
        }
    },

    /**
     * Trigger a password reset request (Mock Flow)
     * @param {string} email 
     * @returns {Promise<object>} Result
     */
    async forgotPassword(email) {
        console.log(`[AuthService] Requesting password reset code for: ${email}`);
        return await apiClient.post('/auth/forgot-password', { email });
    },

    /**
     * Reset password using temporary validation token (Mock Flow)
     * @param {string} token 
     * @param {string} newPassword 
     * @returns {Promise<object>} Result
     */
    async resetPassword(token, newPassword) {
        console.log('[AuthService] Submitting password reset derivation');
        return await apiClient.post('/auth/reset-password', { token, newPassword });
    },

    /**
     * Change password for active logged-in user
     * @param {string} currentPassword 
     * @param {string} newPassword 
     * @returns {Promise<object>} Result
     */
    async changePassword(currentPassword, newPassword) {
        console.log('[AuthService] Submitting password change request');
        return await apiClient.post('/users/change-password', { currentPassword, newPassword });
    }
};

export default authService;
