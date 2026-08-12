import { PublisherInterface } from './PublisherInterface.js';

/**
 * SocialHub Meta Instagram Business Publisher Strategy
 * Posts media to Instagram Business Accounts via Meta Graph API v18.0.
 * Requires an Instagram Business / Creator Account linked to a Facebook Page.
 */
export class InstagramPublisher extends PublisherInterface {
    constructor() {
        super();
        this.platform = 'instagram';
        this.apiVersion = 'v18.0';
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    }

    async connect(credentials) {
        return !!credentials;
    }

    async disconnect(credentials) {
        return true;
    }

    async validate(post) {
        const caption = post.caption || post.content || '';
        if (!caption.trim() && (!post.media || post.media.length === 0)) {
            return { isValid: false, error: "Instagram post content or image is required." };
        }
        if (caption.length > 2200) {
            return { isValid: false, error: "Instagram caption exceeds 2,200 character limit." };
        }
        return { isValid: true, error: null };
    }

    async publish(post, credentials) {
        const validation = await this.validate(post);
        if (!validation.isValid) {
            return {
                success: false,
                provider: 'instagram',
                provider_post_id: null,
                published_at: null,
                error_code: 'VALIDATION_ERROR',
                error_message: validation.error,
                retryable: false
            };
        }

        const accessToken = credentials.access_token;
        let igAccountId = credentials.account_id;

        if (!accessToken) {
            return {
                success: false,
                provider: 'instagram',
                provider_post_id: null,
                published_at: null,
                error_code: 'AUTH_ERROR',
                error_message: 'Instagram access token is missing. Please reconnect Instagram in Accounts page.',
                retryable: false
            };
        }

        // Auto-resolve real Instagram Business Account ID if account_id is a Facebook Page ID
        if (igAccountId && accessToken) {
            try {
                let resolvedIgId = null;
                const pageRes = await fetch(`${this.baseUrl}/${igAccountId}?fields=instagram_business_account{id,username,name}&access_token=${accessToken}`);
                if (pageRes.ok) {
                    const pageData = await pageRes.json();
                    if (pageData.instagram_business_account && pageData.instagram_business_account.id) {
                        resolvedIgId = pageData.instagram_business_account.id;
                    }
                }
                
                // Fallback: check page_backed_instagram_accounts if instagram_business_account wasn't returned
                if (!resolvedIgId) {
                    const pbaRes = await fetch(`${this.baseUrl}/${igAccountId}/page_backed_instagram_accounts?access_token=${accessToken}`);
                    if (pbaRes.ok) {
                        const pbaData = await pbaRes.json();
                        if (pbaData.data && pbaData.data.length > 0 && pbaData.data[0].id) {
                            resolvedIgId = pbaData.data[0].id;
                        }
                    }
                }

                if (resolvedIgId) {
                    console.log(`[InstagramPublisher] Auto-resolved real IG Account ID: ${resolvedIgId} (was ${igAccountId})`);
                    igAccountId = resolvedIgId;
                }
            } catch (e) {
                console.warn(`[InstagramPublisher] Auto-resolve IG Business ID warning:`, e.message);
            }
        }

        if (!igAccountId || igAccountId.startsWith('mock_') || igAccountId.startsWith('ig_')) {
            return {
                success: false,
                provider: 'instagram',
                provider_post_id: null,
                published_at: null,
                error_code: 'NO_BUSINESS_ACCOUNT',
                error_message: 'Akaun Instagram ini belum disambungkan dengan Facebook Page / Instagram Business ID yang sah. Sila tekam Reconnect di halaman Accounts.',
                retryable: false
            };
        }

        const caption = post.caption || post.content || '';

        // Extract image URL from post.media, caption regex, or fallback
        let imageUrl = null;
        if (post.media && Array.isArray(post.media) && post.media.length > 0) {
            for (const item of post.media) {
                if (typeof item === 'object' && item.id) {
                    imageUrl = `https://socialhub-api.huzaimrosli.workers.dev/api/media/file?id=${item.id}`;
                    break;
                }
                const urlCandidate = typeof item === 'string' ? item : (item.public_url || item.url || item.file_path || item.src);
                if (urlCandidate && typeof urlCandidate === 'string' && urlCandidate.startsWith('http')) {
                    imageUrl = urlCandidate;
                    break;
                }
            }
        }

        if (!imageUrl || imageUrl.startsWith('data:image/')) {
            const imgMatch = caption.match(/📷\s*(https?:\/\/\S+)/i) || 
                             caption.match(/(https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?)/i) ||
                             caption.match(/(https?:\/\/images\.unsplash\.com\/\S+)/i);
            if (imgMatch) {
                imageUrl = imgMatch[1].trim();
            }
        }

        // Fallback default image for Instagram Feed if no valid HTTP image is present
        if (!imageUrl || imageUrl.startsWith('data:image/')) {
            imageUrl = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80';
        }

        const cleanedCaption = caption.replace(/📷\s*https?:\/\/\S+/gi, '').trim();

        try {
            // 1. Create Media Container
            console.log(`[InstagramPublisher] Creating media container for IG Account ${igAccountId}...`);
            const containerUrl = `${this.baseUrl}/${igAccountId}/media`;
            const formData = new URLSearchParams();
            formData.append('image_url', imageUrl);
            formData.append('caption', cleanedCaption);
            formData.append('access_token', accessToken);

            let containerRes = await fetch(containerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString()
            });

            let containerData = await containerRes.json().catch(() => ({}));

            // Fallback retry using JSON body if form-urlencoded fails
            if (!containerRes.ok && containerData.error && (containerData.error.code === 10 || containerData.error.code === 100)) {
                console.warn(`[InstagramPublisher] Error #${containerData.error.code} on form-urlencoded attempt, retrying with Bearer Header & JSON...`);
                const jsonRes = await fetch(containerUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        image_url: imageUrl,
                        caption: cleanedCaption
                    })
                });
                if (jsonRes.ok) {
                    containerRes = jsonRes;
                    containerData = await jsonRes.json().catch(() => ({}));
                }
            }

            if (!containerRes.ok || !containerData.id) {
                const err = containerData.error || {};
                let errMsg = err.message || `HTTP ${containerRes.status}`;
                if (err.code === 10 || errMsg.toLowerCase().includes('permission')) {
                    errMsg = `Akaun Instagram ini memerlukan pengesahan semula (Meta Token Expiry). Sila pergi ke halaman Accounts dan tekan "Reconnect" pada akaun Instagram anda.`;
                }

                console.error(`[InstagramPublisher] Container creation failed:`, containerData);
                return {
                    success: false,
                    provider: 'instagram',
                    provider_post_id: null,
                    published_at: null,
                    error_code: err.code?.toString() || 'CONTAINER_FAILED',
                    error_message: errMsg,
                    retryable: false
                };
            }

            const containerId = containerData.id;
            console.log(`[InstagramPublisher] Container created ID: ${containerId}. Waiting for readiness...`);

            // 2. Publish Media Container with Smart Readiness Retry
            console.log(`[InstagramPublisher] Publishing container ID: ${containerId}...`);
            const publishUrl = `${this.baseUrl}/${igAccountId}/media_publish?access_token=${encodeURIComponent(accessToken)}`;
            const pubFormData = new URLSearchParams();
            pubFormData.append('creation_id', containerId);
            pubFormData.append('access_token', accessToken);

            let publishData = null;
            let publishRes = null;
            let publishSuccess = false;

            // Wait 2s initial grace period for Meta image processing
            await new Promise(resolve => setTimeout(resolve, 2000));

            for (let pubAttempt = 1; pubAttempt <= 6; pubAttempt++) {
                publishRes = await fetch(publishUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: pubFormData.toString()
                });

                publishData = await publishRes.json().catch(() => ({}));

                if (publishRes.ok && publishData.id) {
                    publishSuccess = true;
                    break;
                }

                const errSubcode = publishData.error?.error_subcode || publishData.error?.code;
                const errMessage = publishData.error?.message || '';

                console.warn(`[InstagramPublisher] Publish attempt ${pubAttempt} for container ${containerId} status ${publishRes.status}:`, publishData);

                // If Meta container is not ready yet (subcode 2207027 or 'not ready' message), wait 3 seconds and retry
                if (pubAttempt < 6 && (errSubcode === 2207027 || errMessage.toLowerCase().includes('not ready') || errMessage.toLowerCase().includes('in_progress'))) {
                    console.log(`[InstagramPublisher] Container ${containerId} not ready yet, waiting 3s before retry ${pubAttempt + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    break;
                }
            }

            if (!publishSuccess || !publishData?.id) {
                const err = publishData?.error || {};
                const errMsg = err.message || `HTTP ${publishRes?.status || 500}`;
                console.error(`[InstagramPublisher] Media publication failed after retries:`, publishData);
                return {
                    success: false,
                    provider: 'instagram',
                    provider_post_id: null,
                    published_at: null,
                    error_code: err.code?.toString() || 'PUBLISH_FAILED',
                    error_message: `Ralat penerbitan Instagram: ${errMsg}`,
                    retryable: true
                };
            }

            console.log(`[InstagramPublisher] Successfully published post ID: ${publishData.id}`);
            return {
                success: true,
                provider: 'instagram',
                provider_post_id: publishData.id,
                published_at: new Date().toISOString(),
                error_code: null,
                error_message: null,
                retryable: false
            };

        } catch (e) {
            console.error('[InstagramPublisher] Publishing exception:', e.message);
            return {
                success: false,
                provider: 'instagram',
                provider_post_id: null,
                published_at: null,
                error_code: 'NETWORK_ERROR',
                error_message: e.message,
                retryable: true
            };
        }
    }

    async refreshToken(token) {
        return { access_token: token, expires_in: 5184000 };
    }
}

export default InstagramPublisher;
