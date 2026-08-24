import { PublisherInterface } from './PublisherInterface.js';

/**
 * Facebook Page Publisher
 * Posts content to a connected Facebook Page using Graph API v18.0
 * Requires: pages_manage_posts, pages_read_engagement, pages_show_list
 *
 * Token Strategy:
 *   The stored token is expected to be a Page Access Token.
 *   If a permission error (#200, #190, pages_manage_posts) occurs,
 *   we automatically resolve the fresh Page Access Token from Graph API and retry!
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
        let pageAccessToken = credentials.access_token;
        const pageId = credentials.account_id;
        const userToken = credentials.user_token || credentials.refresh_token;

        if (!pageAccessToken && !userToken) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_TOKEN',
                error_message: 'Facebook access token is missing. Please reconnect your Facebook Page in Accounts.',
                retryable: false
            };
        }

        if (!pageId) {
            return {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'NO_PAGE_ID',
                error_message: 'Facebook Page ID is missing. Please reconnect your Facebook Page account in Accounts.',
                retryable: false
            };
        }

        const message = (post.caption || post.content || '')
            .replace(/[\n\r]*(?:---thread-separator---|\[THREAD_DELIMITER\])[\n\r]*/g, '\n\n')
            .trim();

        try {
            let result = null;
            if (pageAccessToken) {
                result = await this._postToPage(pageId, message, pageAccessToken, post);
            }

            // Self-Healing: If Facebook rejects due to permission / page token error (#200, #190, #10), auto-resolve fresh Page Access Token
            if (!result || !result.success) {
                const errCode = result?.error_code || '';
                const errMsg = result?.error_message?.toLowerCase() || '';
                const isPermissionOrTokenError = !result || 
                    errCode === '200' || 
                    errCode === '190' || 
                    errCode === '10' ||
                    errMsg.includes('permission') ||
                    errMsg.includes('pages_manage_posts') ||
                    errMsg.includes('does not have permission') ||
                    errMsg.includes('expired');

                if (isPermissionOrTokenError) {
                    console.log(`[FacebookPublisher] Encountered permission/token error on Page ${pageId}. Resolving fresh Page Access Token...`);
                    
                    // Try resolving using user token first, then fallback to current token
                    const tokensToTry = [userToken, pageAccessToken].filter(t => t && t.length > 30 && !t.includes('no-refresh-token') && !t.includes('mock'));
                    
                    for (const t of tokensToTry) {
                        const freshPageToken = await this._resolvePageToken(pageId, t);
                        if (freshPageToken && freshPageToken !== pageAccessToken) {
                            console.log(`[FacebookPublisher] Successfully resolved fresh Page Token from Meta! Retrying publish...`);
                            const retryResult = await this._postToPage(pageId, message, freshPageToken, post);
                            if (retryResult.success) {
                                retryResult.new_access_token = freshPageToken;
                                return retryResult;
                            }
                        }
                    }
                }
            }

            return result || {
                success: false,
                provider: 'facebook',
                provider_post_id: null,
                error_code: 'PUBLISH_FAILED',
                error_message: 'Failed to publish to Facebook Page',
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

    /**
     * Helper to resolve the correct Page Access Token using direct page query or /me/accounts
     */
    async _resolvePageToken(pageId, token) {
        if (!token) return null;
        try {
            // 1. /me/accounts fetch (Works with User Access Token)
            const meRes = await fetch(`${this.baseUrl}/me/accounts?fields=id,name,access_token&access_token=${token}`);
            if (meRes.ok) {
                const meData = await meRes.json();
                const pages = meData.data || [];
                const matched = pages.find(p => p.id?.toString() === pageId?.toString());
                if (matched && matched.access_token) {
                    console.log(`[FacebookPublisher] Found Page Token via /me/accounts for Page ${matched.name} (${matched.id})`);
                    return matched.access_token;
                }
            }

            // 2. Direct page fetch
            const directRes = await fetch(`${this.baseUrl}/${pageId}?fields=id,name,access_token&access_token=${token}`);
            if (directRes.ok) {
                const directData = await directRes.json();
                if (directData.access_token) {
                    console.log(`[FacebookPublisher] Found Page Token via direct page query for Page ID ${pageId}`);
                    return directData.access_token;
                }
            }
        } catch (e) {
            console.error('[FacebookPublisher] _resolvePageToken failed:', e.message);
        }
        return null;
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

