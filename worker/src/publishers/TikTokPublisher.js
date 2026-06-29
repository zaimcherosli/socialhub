import { BasePublisher } from './BasePublisher.js';

export class TikTokPublisher extends BasePublisher {
    constructor() {
        super('tiktok');
    }
    async connect() { return true; }
    async validate(post) { return { isValid: true, error: null }; }
    async publish(post) {
        return {
            success: true,
            provider: 'tiktok',
            provider_post_id: `tk-post-${Math.floor(Math.random() * 90000) + 10000}`,
            published_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
            retryable: false
        };
    }
    async delete() { return { success: true }; }
    async refreshToken() { return { access_token: "refreshed-mock-tk-token", expires_in: 86400 }; }
    async disconnect() { return true; }
    async healthCheck() { return { status: 'healthy', latency_ms: 130 }; }
}
export default TikTokPublisher;
