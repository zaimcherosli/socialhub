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
                if (platform === 'threads' || platform === 'instagram') {
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    if (isMobile) {
                        const platformName = platform === 'threads' ? 'Threads' : 'Instagram';
                        const proceed = confirm(
                            `Peringatan (Mobile):\n\n` +
                            `Sistem akan membuka laman web ${platformName} untuk sambungan. ` +
                            `Jika telefon anda membuka aplikasi ${platformName} secara automatik dan tersekat, sila:\n\n` +
                            `1. Guna komputer/desktop untuk sambung (Sangat Disyorkan)\n` +
                            `2. ATAU, buka tetapan telefon anda -> Apps -> ${platformName} -> 'Open by default' -> matikan 'Open supported links'.\n\n` +
                            `Adakah anda ingin meneruskan sekarang?`
                        );
                        if (!proceed) return;
                    }
                }
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
                if (data.redirect_url.includes('threads.net') || data.redirect_url.includes('instagram.com')) {
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    if (isMobile) {
                        const isThreads = data.redirect_url.includes('threads.net');
                        const platformName = isThreads ? 'Threads' : 'Instagram';
                        const proceed = confirm(
                            `Peringatan (Mobile):\n\n` +
                            `Sistem akan membuka laman web ${platformName} untuk sambungan semula. ` +
                            `Jika telefon anda membuka aplikasi ${platformName} secara automatik dan tersekat, sila:\n\n` +
                            `1. Guna komputer/desktop untuk sambung (Sangat Disyorkan)\n` +
                            `2. ATAU, buka tetapan telefon anda -> Apps -> ${platformName} -> 'Open by default' -> matikan 'Open supported links'.\n\n` +
                            `Adakah anda ingin meneruskan sekarang?`
                        );
                        if (!proceed) return;
                    }
                }
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
