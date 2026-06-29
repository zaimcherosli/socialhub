/* SocialHub Token Metadata Formatting Service
   Helper calculations for connected channel token lifespans and formatting. */

export const tokenService = {
    /**
     * Check if a token connection lifetime has expired
     * @param {string} expiresAt ISO8601 string
     * @returns {boolean}
     */
    isTokenExpired(expiresAt) {
        if (!expiresAt) return false;
        return new Date(expiresAt) < new Date();
    },

    /**
     * Formats expiration timestamps into legible dashboard text
     * @param {string} expiresAt ISO8601 string
     * @returns {string}
     */
    formatExpiration(expiresAt) {
        if (!expiresAt) return 'Lifetime Connection';
        
        try {
            const date = new Date(expiresAt);
            if (isNaN(date.getTime())) return 'Unknown Expiration';
            
            return date.toLocaleDateString(undefined, { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            });
        } catch (e) {
            return 'Unknown Expiration';
        }
    }
};

export default tokenService;
