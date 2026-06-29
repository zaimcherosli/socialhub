import { PublisherInterface } from './PublisherInterface.js';

export class TikTokPublisher extends PublisherInterface {
    constructor() {
        super();
        this.platform = 'tiktok';
    }

    async connect(credentials) { 
        return true; 
    }

    async disconnect(credentials) { 
        return true; 
    }

    async publish(post, credentials) {
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

    async validate(post) { 
        return { isValid: true, error: null }; 
    }

    async refreshToken(token) { 
        return { access_token: "refreshed-mock-tk-token", expires_in: 86400 }; 
    }
}

export default TikTokPublisher;
