import { PublisherInterface } from './PublisherInterface.js';

/**
 * Facebook Page Publisher
 * Posts content to a connected Facebook Page using Graph API v18.0
 * Requires: pages_manage_posts, pages_read_engagement, pages_show_list
 *
 * Token Strategy:
 *   The stored token is expected to be a Page Access Token.
 *   We post directly to /{page_id}/feed using the stored token.
 *   No /me/accounts fallback — Page Access Tokens cannot fetch user page lists.
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
     * Publish a post directly to a Facebook Page using the stored Page Access Token.
     */
    async publish(post, credentials) {
        const pageAccessToken = credentials.access_token;
        const pageId = credentials.account_id;

        if (!pageAccessToken) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_TOKEN',
                error_message: 'Facebook access token is missing. Please reconnect your Facebook Page.',
                retryable: false
            };
        }

        if (!pageId) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_PAGE_ID',
                error_message: 'Facebook Page ID is missing. Please reconnect your Facebook Page account.',
                retryable: false
            };
        }

        const message = (post.caption || post.content || '')
            .replace(/[\n\r]*(?:---thread-separator---|\[THREAD_DELIMITER\])[\n\r]*/g, '\n\n')
            .trim();

        try {
            return await this._postToPage(pageId, message, pageAccessToken, post);
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

    /**
     * POST to a Facebook Page feed using the Page Access Token.
     * Returns a standardised result object.
     */
    async _postToPage(pageId, message, pageAccessToken, post) {
        let endpoint = `${this.baseUrl}/${pageId}/feed`;
        const payload = { message, access_token: pageAccessToken };

        // If media attached, use /photos endpoint instead
        if (post.media && post.media.length > 0 && post.media[0].url) {
            endpoint = `${this.baseUrl}/${pageId}/photos`;
            payload.url = post.media[0].url;
            payload.caption = message;
            delete payload.message;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok || result.error) {
            const fbError = result.error || {};
            const errCode = fbError.code?.toString() || response.status.toString();
            const errType = fbError.type || 'API_ERROR';
            const errMsg  = fbError.message || `HTTP ${response.status}`;

            // Build a helpful message based on Facebook error code
            let friendlyMsg = errMsg;
            if (fbError.code === 190) {
                friendlyMsg = `Facebook token expired or invalid. Please reconnect your Facebook Page. (${errMsg})`;
            } else if (fbError.code === 200) {
                friendlyMsg = `Missing Facebook permission: pages_manage_posts. Please reconnect with correct permissions. (${errMsg})`;
            } else if (fbError.code === 100) {
                friendlyMsg = `Invalid Facebook Page ID or unsupported request. (${errMsg})`;
            }

            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: errCode,
                error_type: errType,
                error_message: friendlyMsg,
                retryable: response.status >= 500
            };
        }

        return {
            success: true,
            provider: 'facebook',
            provider_post_id: result.id || result.post_id,
            published_at: new Date().toISOString(),
            page_id: pageId,
            error_code: null,
            error_message: null,
            retryable: false
        };
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
        // Facebook Page Access Tokens derived from long-lived user tokens never expire
        return { access_token: token, expires_in: 5184000 };
    }
}

export default FacebookPublisher;
