/**
 * SocialHub AI Provider Base Interface
 * Defines the strict contract all AI providers must implement.
 */
export class AIProvider {
    /**
     * Generate captions based on input parameters.
     * @param {object} promptOptions { businessType, product, targetAudience, goal, tone, language }
     * @returns {Promise<object>} JSON structure { caption, cta, hashtags }
     */
    async generateCaption(promptOptions) {
        throw new Error("generateCaption must be implemented by subclasses");
    }

    /**
     * Generate thread storm copywriting from URL details.
     * @param {object} options { title, description, url, tone, language }
     * @returns {Promise<object>} JSON structure { title, threads: string[], cta, hashtags }
     */
    async generateThreadStorm(options) {
        throw new Error("generateThreadStorm must be implemented by subclasses");
    }

    /**
     * Generate chat responses based on chat history.
     * @param {object[]} messages Array of messages { role, content }
     * @returns {Promise<string>} Plain text response
     */
    async generateChatResponse(messages) {
        throw new Error("generateChatResponse must be implemented by subclasses");
    }
}

