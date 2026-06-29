/* SocialHub OAuth Redirection Service
   Handles initiating and handling third-party oauth browser redirects. */

import { socialService } from './socialService.js';

export const oauthService = {
    /**
     * Start connection flow by requesting authorization URL and redirecting the browser
     * @param {string} platform Platform target identifier
     */
    async initiateConnect(platform) {
        try {
            const data = await socialService.connectAccount(platform);
            if (data && data.redirect_url) {
                console.log(`[OAuthService] Directing viewport redirect: ${data.redirect_url}`);
                window.location.href = data.redirect_url;
            } else {
                throw new Error("Invalid OAuth redirection payload returned");
            }
        } catch (error) {
            console.error(`[OAuthService] Failed to initiate connection for ${platform}:`, error.message);
            alert(`Connection initialization failed: ${error.message}`);
        }
    },

    /**
     * Start reconnection flow for an existing channel
     * @param {number|string} accountId 
     */
    async initiateReconnect(accountId) {
        try {
            const data = await socialService.reconnectAccount(accountId);
            if (data && data.redirect_url) {
                console.log(`[OAuthService] Directing reconnection redirect: ${data.redirect_url}`);
                window.location.href = data.redirect_url;
            } else {
                throw new Error("Invalid OAuth redirection payload returned");
            }
        } catch (error) {
            console.error(`[OAuthService] Failed to initiate reconnection for channel ID ${accountId}:`, error.message);
            alert(`Reconnection initialization failed: ${error.message}`);
        }
    }
};

export default oauthService;
