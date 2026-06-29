/* SocialHub Form & Platform Word Limit Validation Service
   Enforces editor input validation checks and character bounds limits per platform. */

const PLATFORM_CHARACTER_LIMITS = {
    threads: 500,
    twitter: 280,
    linkedin: 3000,
    tiktok: 2200,
    facebook: 63000,
    instagram: 2200
};

export const validationService = {
    /**
     * Enforce core editor form validation rules
     * @param {string} title 
     * @param {string} caption 
     * @returns {object} Validation report
     */
    validatePostForm(title, caption) {
        const errors = {};
        
        if (!title || !title.trim()) {
            errors.title = 'A title is required to organize your posts.';
        }
        
        if (!caption || !caption.trim()) {
            errors.caption = 'Caption content cannot be empty.';
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    },

    /**
     * Check if caption exceeds character limit margins of target platforms
     * @param {string} caption 
     * @param {string} platform Platform target (threads, facebook, instagram, linkedin, tiktok, twitter)
     * @returns {object} { exceedsLimit, limit, remaining }
     */
    validatePlatformLimits(caption, platform) {
        const textLength = caption ? caption.length : 0;
        const limit = PLATFORM_CHARACTER_LIMITS[platform.toLowerCase()];
        
        if (!limit) {
            return {
                exceedsLimit: false,
                limit: Infinity,
                remaining: Infinity
            };
        }

        const remaining = limit - textLength;
        return {
            exceedsLimit: remaining < 0,
            limit,
            remaining
        };
    }
};

export default validationService;
