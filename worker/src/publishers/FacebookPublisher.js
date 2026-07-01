import { PublisherInterface } from './PublisherInterface.js';

/**
 * Facebook Page Publisher
 * Posts content to a connected Facebook Page using Graph API v18.0
 * Requires: pages_manage_posts, pages_read_engagement, pages_show_list
 *
 * Token Strategy:
 *   1. Try stored token DIRECTLY as a Page Access Token -> /{page_id}/feed
 *   2. If that fails with OAuthException, fall back to treating it as a
 *      User Access Token and fetch the Page token via /me/accounts.
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
     * Publish a post to a Facebook Page.
     * First attempts direct Page Access Token approach, then falls back to /me/accounts.
     */
    async publish(post, credentials) {
        const storedToken = credentials.access_token;
        const storedPageId = credentials.account_id;

        if (!storedToken) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_TOKEN',
                error_message: 'Facebook access token is missing.',
                retryable: false
            };
        }

        const message = post.caption || post.content || '';

        try {
            // === STRATEGY 1: Use stored token directly as Page Access Token ===
            const directResult = await this._postToPage(storedPageId, message, storedToken, post);
            if (directResult.success) {
                return directResult;
            }

            // If OAuth failure, try fallback with /me/accounts
            if (directResult.error_code === 'OAUTH_EXCEPTION') {
                console.log('[FacebookPublisher] Direct token failed with OAuthException, trying /me/accounts fallback...');
                const pageToken = await this._getPageTokenFromUserToken(storedToken, storedPageId);
                return await this._postToPage(pageToken.pageId, message, pageToken.pageAccessToken, post, pageToken.pageName);
            }

            return directResult;

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
     * Post to a specific Facebook Page feed using the provided Page Access Token.
     */
    async _postToPage(pageId, message, pageAccessToken, post, pageName = null) {
        let endpoint = `${this.baseUrl}/${pageId}/feed`;
        const payload = { message, access_token: pageAccessToken };

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
            const errMsg = result.error?.message || `HTTP ${response.status}`;
            const errCode = result.error?.code?.toString() || 'API_ERROR';
            const isOAuth = result.error?.type === 'OAuthException';
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: isOAuth ? 'OAUTH_EXCEPTION' : errCode,
                error_message: errMsg,
                retryable: response.status >= 500
            };
        }

        return {
            success: true,
            provider: 'facebook',
            provider_post_id: result.id || result.post_id,
            published_at: new Date().toISOString(),
            page_name: pageName || pageId,
            page_id: pageId,
            error_code: null,
            error_message: null,
            retryable: false
        };
    }

    /**
     * Fall back: use a User Access Token to fetch the correct Page Access Token via /me/accounts.
     */
    async _getPageTokenFromUserToken(userAccessToken, pageId) {
        const res = await fetch(`${this.baseUrl}/me/accounts?access_token=${userAccessToken}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || 'Failed to fetch Facebook pages via /me/accounts');
        }
        const data = await res.json();
        const pages = data.data || [];

        if (pages.length === 0) {
            throw new Error('No Facebook Pages found. Ensure you are an admin of at least one Facebook Page and the token has pages_show_list permission.');
        }

        let page = pageId ? pages.find(p => p.id === pageId || p.name === pageId) : null;
        if (!page) page = pages[0];

        return { pageAccessToken: page.access_token, pageId: page.id, pageName: page.name };
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
