/* SocialHub HTTP Client Utility
   Wraps native fetch with base endpoints, header presets, and custom error handling. */

import { CONFIG } from '../config/config.js';

export const apiClient = {
    async request(path, options = {}) {
        const url = `${CONFIG.API_BASE_URL}${path}`;
        
        const token = localStorage.getItem('socialhub_jwt') || sessionStorage.getItem('socialhub_jwt');

        // Add default Headers
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(url, config);
            
            // Handle HTTP error codes
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
            }

            // Return JSON if present, otherwise empty body
            if (response.status === 204) return null;
            return await response.json();
        } catch (error) {
            console.error(`🔴 API Client Error [${options.method || 'GET'} ${path}]:`, error.message);
            throw error;
        }
    },

    get(path, headers = {}) {
        return this.request(path, { method: 'GET', headers });
    },

    post(path, body, headers = {}) {
        return this.request(path, { 
            method: 'POST', 
            body: JSON.stringify(body), 
            headers 
        });
    },

    put(path, body, headers = {}) {
        return this.request(path, { 
            method: 'PUT', 
            body: JSON.stringify(body), 
            headers 
        });
    },

    delete(path, headers = {}) {
        return this.request(path, { method: 'DELETE', headers });
    }
};

export default apiClient;
