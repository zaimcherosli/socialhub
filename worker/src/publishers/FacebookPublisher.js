import { PublisherInterface } from './PublisherInterface.js';

/**
 * Facebook Page Publisher
 * Posts content to a connected Facebook Page using Graph API v18.0
 * Requires: pages_manage_posts, pages_read_engagement, pages_show_list
 */
export class FacebookPublisher extends PublisherInterface {
    constructor() {
        super();
        this.platform = 'facebook';
        this.apiVersion = 'v18.0';
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    }

    async connect(credentials) {
        return true;
    }

    async disconnect(credentials) {
        return true;
    }

    /**
     * Get the Page Access Token for the connected Facebook Page
     * The stored token is a User Access Token — we use it to fetch the Page token
     */
    async getPageAccessToken(userAccessToken, pageId) {
        // Fetch all pages this user manages
        const res = await fetch(
            `${this.baseUrl}/me/accounts?access_token=${userAccessToken}`
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || 'Failed to fetch Facebook pages list');
        }
        const data = await res.json();
        const pages = data.data || [];

        if (pages.length === 0) {
            throw new Error('No Facebook Pages found. Please ensure you are an admin of at least one Facebook Page.');
        }

        // If pageId is provided, match it; otherwise use first page
        let page;
        if (pageId) {
            page = pages.find(p => p.id === pageId || p.name === pageId);
        }
        if (!page) {
            page = pages[0]; // Default to first managed page
        }

        return {
            pageAccessToken: page.access_token,
            pageId: page.id,
            pageName: page.name
        };
    }

    /**
     * Publish a text post to the Facebook Page feed
     */
    async publish(post, credentials) {
        const userAccessToken = credentials.access_token;
        const targetPageId = credentials.account_id; // stored during connect

        if (!userAccessToken) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_TOKEN',
                error_message: 'Facebook access token is missing.',
                retryable: false
            };
        }

        try {
            // Step 1: Get Page Access Token
            const { pageAccessToken, pageId, pageName } = await this.getPageAccessToken(
                userAccessToken,
                targetPageId
            );

            // Step 2: Build post payload
            const payload = {
                message: post.caption || post.content || '',
                access_token: pageAccessToken
            };

            // Step 3: If there's an image, use photos endpoint instead
            let endpoint = `${this.baseUrl}/${pageId}/feed`;
            if (post.media && post.media.length > 0 && post.media[0].url) {
                endpoint = `${this.baseUrl}/${pageId}/photos`;
                payload.url = post.media[0].url;
                payload.caption = payload.message;
                delete payload.message;
            }

            // Step 4: POST to Facebook Graph API
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok || result.error) {
                const errMsg = result.error?.message || `HTTP ${response.status}`;
                return {
                    success: false,
                    provider: 'facebook',
                    provider_post_id: null,
                    error_code: result.error?.code?.toString() || 'API_ERROR',
                    error_message: errMsg,
                    retryable: response.status >= 500
                };
            }

            return {
                success: true,
                provider: 'facebook',
                provider_post_id: result.id || result.post_id,
                published_at: new Date().toISOString(),
                page_name: pageName,
                page_id: pageId,
                error_code: null,
                error_message: null,
                retryable: false
            };

        } catch (err) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'EXCEPTION',
                error_message: err.message,
                retryable: false
            };
        }
    }

    async validate(post) {
        if (!post.caption && !post.content) {
            return { isValid: false, error: 'Post content/caption is required for Facebook.' };
        }
        if ((post.caption || post.content || '').length > 63206) {
            return { isValid: false, error: 'Facebook post exceeds 63,206 character limit.' };
        }
        return { isValid: true, error: null };
    }

    async refreshToken(token) {
        // Facebook long-lived tokens last 60 days — exchange short-lived for long-lived
        return { access_token: token, expires_in: 5184000 };
    }
}

export default FacebookPublisher;
