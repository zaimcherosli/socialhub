/**
 * SocialHub Threads Platform Publisher Strategy
 * Enforces Threads specific validation checks and returns standardized publication response payloads.
 */

import { PublisherInterface } from './PublisherInterface.js';

export class ThreadsPublisher extends PublisherInterface {
    constructor() {
        super();
        this.platform = 'threads';
    }

    async connect(credentials) {
        return !!credentials;
    }

    async validate(post) {
        if (!post.caption || !post.caption.trim()) {
            return { isValid: false, error: "Threads caption content cannot be empty." };
        }
        if (post.caption.length > 500) {
            return { isValid: false, error: "Threads caption exceeds Meta's 500-character limit." };
        }
        return { isValid: true, error: null };
    }

    async publish(post, credentials) {
        // Enforce validations first
        const validation = await this.validate(post);
        if (!validation.isValid) {
            return {
                success: false,
                provider: 'threads',
                provider_post_id: null,
                published_at: null,
                error_code: 'VALIDATION_ERROR',
                error_message: validation.error,
                retryable: false
            };
        }

        const accessToken = credentials.access_token;
        if (!accessToken) {
            return {
                success: false,
                provider: 'threads',
                provider_post_id: null,
                published_at: null,
                error_code: 'AUTH_ERROR',
                error_message: 'Access token is missing.',
                retryable: false
            };
        }

        try {
            // Step 1: Create a Threads media container
            console.log(`[ThreadsPublisher] Creating media container for caption: ${post.caption}`);
            
            const containerUrl = new URL('https://graph.threads.net/v1.0/me/threads');
            containerUrl.searchParams.set('media_type', 'TEXT');
            containerUrl.searchParams.set('text', post.caption);
            containerUrl.searchParams.set('access_token', accessToken);

            const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
            const containerData = await containerRes.json();

            if (!containerRes.ok || !containerData.id) {
                console.error('[ThreadsPublisher] Media container creation failed:', containerData);
                return {
                    success: false,
                    provider: 'threads',
                    provider_post_id: null,
                    published_at: null,
                    error_code: 'API_ERROR',
                    error_message: containerData.error?.message || 'Failed to create media container.',
                    retryable: true
                };
            }

            const containerId = containerData.id;
            console.log(`[ThreadsPublisher] Created media container ID: ${containerId}`);

            // Step 2: Publish the media container
            console.log(`[ThreadsPublisher] Publishing media container ID: ${containerId}`);
            
            const publishUrl = new URL('https://graph.threads.net/v1.0/me/threads_publish');
            publishUrl.searchParams.set('creation_id', containerId);
            publishUrl.searchParams.set('access_token', accessToken);

            const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
            const publishData = await publishRes.json();

            if (!publishRes.ok || !publishData.id) {
                console.error('[ThreadsPublisher] Media container publication failed:', publishData);
                return {
                    success: false,
                    provider: 'threads',
                    provider_post_id: null,
                    published_at: null,
                    error_code: 'API_ERROR',
                    error_message: publishData.error?.message || 'Failed to publish media container.',
                    retryable: true
                };
            }

            const postId = publishData.id;
            console.log(`[ThreadsPublisher] Successfully published post to Threads. Post ID: ${postId}`);

            return {
                success: true,
                provider: 'threads',
                provider_post_id: postId,
                published_at: new Date().toISOString(),
                error_code: null,
                error_message: null,
                retryable: false
            };
        } catch (e) {
            console.error('[ThreadsPublisher] Publishing error:', e.message);
            return {
                success: false,
                provider: 'threads',
                provider_post_id: null,
                published_at: null,
                error_code: 'NETWORK_ERROR',
                error_message: e.message,
                retryable: true
            };
        }
    }

    async delete(externalPostId, credentials) {
        return { success: true };
    }

    async refreshToken(credentials) {
        return { 
            access_token: "refreshed-mock-threads-token-990011", 
            expires_in: 86400 * 60 
        };
    }

    async disconnect(credentials) {
        return true;
    }

    async healthCheck() {
        return { status: 'healthy', latency_ms: 120 };
    }
}

export default ThreadsPublisher;
