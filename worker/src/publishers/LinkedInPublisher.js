import { BasePublisher } from './BasePublisher.js';

export class LinkedInPublisher extends BasePublisher {
    constructor() {
        super('linkedin');
    }
    async connect() { return true; }
    async validate(post) { return { isValid: true, error: null }; }
    async publish(post) {
        return {
            success: true,
            provider: 'linkedin',
            provider_post_id: `li-post-${Math.floor(Math.random() * 90000) + 10000}`,
            published_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
            retryable: false
        };
    }
    async delete() { return { success: true }; }
    async refreshToken() { return { access_token: "refreshed-mock-li-token", expires_in: 86400 }; }
    async disconnect() { return true; }
    async healthCheck() { return { status: 'healthy', latency_ms: 110 }; }
}
export default LinkedInPublisher;
