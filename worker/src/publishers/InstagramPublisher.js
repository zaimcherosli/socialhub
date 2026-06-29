import { BasePublisher } from './BasePublisher.js';

export class InstagramPublisher extends BasePublisher {
    constructor() {
        super('instagram');
    }
    async connect() { return true; }
    async validate(post) { return { isValid: true, error: null }; }
    async publish(post) {
        return {
            success: true,
            provider: 'instagram',
            provider_post_id: `ig-post-${Math.floor(Math.random() * 90000) + 10000}`,
            published_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
            retryable: false
        };
    }
    async delete() { return { success: true }; }
    async refreshToken() { return { access_token: "refreshed-mock-ig-token", expires_in: 86400 }; }
    async disconnect() { return true; }
    async healthCheck() { return { status: 'healthy', latency_ms: 95 }; }
}
export default InstagramPublisher;
