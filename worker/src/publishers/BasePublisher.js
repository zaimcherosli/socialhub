/**
 * SocialHub abstract Base Publisher Class
 * Defines the unified contract interface for all third-party social media providers.
 */

export class BasePublisher {
    constructor(platform) {
        this.platform = platform;
    }

    /**
     * Link provider credentials context
     */
    async connect(credentials) {
        throw new Error(`Method 'connect' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Enforce provider validations
     * @returns {Promise<{isValid: boolean, error: string|null}>}
     */
    async validate(post) {
        throw new Error(`Method 'validate' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Dispatch publication payload to provider API
     * @returns {Promise<object>} Standard response payload
     */
    async publish(post, credentials) {
        throw new Error(`Method 'publish' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Sever / delete published post
     */
    async delete(externalPostId, credentials) {
        throw new Error(`Method 'delete' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Refresh OAuth access tokens
     */
    async refreshToken(credentials) {
        throw new Error(`Method 'refreshToken' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Disconnect platform credentials
     */
    async disconnect(credentials) {
        throw new Error(`Method 'disconnect' not implemented on publisher strategy: ${this.platform}`);
    }

    /**
     * Health check endpoint probe
     */
    async healthCheck() {
        throw new Error(`Method 'healthCheck' not implemented on publisher strategy: ${this.platform}`);
    }
}

export default BasePublisher;
