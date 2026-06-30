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
        // Support thread storms up to 5000 characters
        if (post.caption.length > 5000) {
            return { isValid: false, error: "Threads caption exceeds 5000-character limit." };
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

        // Helper: split text into chunks of <= 500 characters on paragraph/word bounds
        const splitTextIntoThreads = (text, limit = 500) => {
            if (text.length <= limit) return [text];
            
            const paragraphs = text.split('\n');
            const chunks = [];
            let currentChunk = "";
            
            for (const paragraph of paragraphs) {
                if (paragraph.length > limit) {
                    const words = paragraph.split(' ');
                    for (const word of words) {
                        if ((currentChunk + " " + word).trim().length > limit) {
                            chunks.push(currentChunk.trim());
                            currentChunk = word;
                        } else {
                            currentChunk = (currentChunk + " " + word).trim();
                        }
                    }
                } else {
                    if ((currentChunk + "\n" + paragraph).trim().length > limit) {
                        chunks.push(currentChunk.trim());
                        currentChunk = paragraph;
                    } else {
                        currentChunk = currentChunk ? (currentChunk + "\n" + paragraph) : paragraph;
                    }
                }
            }
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            return chunks;
        };

        try {
            const chunks = splitTextIntoThreads(post.caption, 500);
            console.log(`[ThreadsPublisher] Caption split into ${chunks.length} thread items.`);
            
            let lastPostId = null;
            let firstPostId = null;
            const threadsAccountId = credentials.account_id || 'me';

            for (let i = 0; i < chunks.length; i++) {
                const chunkText = chunks[i];
                console.log(`[ThreadsPublisher] Publishing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 30)}..."`);
                
                const containerUrl = new URL(`https://graph.threads.net/v1.0/${threadsAccountId}/threads`);
                containerUrl.searchParams.set('media_type', 'TEXT');
                containerUrl.searchParams.set('text', chunkText);
                containerUrl.searchParams.set('access_token', accessToken);
                
                // Link subsequent posts as replies to build a thread storm
                if (lastPostId) {
                    containerUrl.searchParams.set('reply_to_id', lastPostId);
                }

                const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
                const containerData = await containerRes.json();

                if (!containerRes.ok || !containerData.id) {
                    console.error(`[ThreadsPublisher] Media container creation failed for part ${i + 1}:`, containerData);
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: null,
                        published_at: null,
                        error_code: 'API_ERROR',
                        error_message: containerData.error?.message || `Failed to create container for part ${i + 1}.`,
                        retryable: true
                    };
                }

                const containerId = containerData.id;

                const publishUrl = new URL(`https://graph.threads.net/v1.0/${threadsAccountId}/threads_publish`);
                publishUrl.searchParams.set('creation_id', containerId);
                publishUrl.searchParams.set('access_token', accessToken);

                const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
                const publishData = await publishRes.json();

                if (!publishRes.ok || !publishData.id) {
                    console.error(`[ThreadsPublisher] Container publication failed for part ${i + 1}:`, publishData);
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: null,
                        published_at: null,
                        error_code: 'API_ERROR',
                        error_message: publishData.error?.message || `Failed to publish part ${i + 1}.`,
                        retryable: true
                    };
                }

                lastPostId = publishData.id;
                if (!firstPostId) {
                    firstPostId = lastPostId;
                }

                // Add a small delay between publications to maintain order on the Threads timeline
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            return {
                success: true,
                provider: 'threads',
                provider_post_id: firstPostId,
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
