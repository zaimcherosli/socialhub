import { BasePublisher } from './BasePublisher.js';

export class FacebookPublisher extends BasePublisher {
    constructor() {
        super('facebook');
    }
    async connect() { return true; }
    async validate(post) { return { isValid: true, error: null }; }
    async publish(post) {
        return {
            success: true,
            provider: 'facebook',
            provider_post_id: `fb-post-${Math.floor(Math.random() * 90000) + 10000}`,
            published_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
            retryable: false
        };
    }
    async delete() { return { success: true }; }
    async refreshToken() { return { access_token: "refreshed-mock-fb-token", expires_in: 86400 }; }
    async disconnect() { return true; }
    async healthCheck() { return { status: 'healthy', latency_ms: 80 }; }
}
export default FacebookPublisher;
