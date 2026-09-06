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

        const splitParagraphsAndWords = (text, limit) => {
            if (text.length <= limit) return [text];
            const paragraphs = text.split('\n');
            const chunks = [];
            let currentChunk = "";
            
            for (const paragraph of paragraphs) {
                if (paragraph.length > limit) {
                    const words = paragraph.split(' ');
                    for (const word of words) {
                        if ((currentChunk + " " + word).trim().length > limit) {
                            if (currentChunk.trim()) chunks.push(currentChunk.trim());
                            currentChunk = word;
                        } else {
                            currentChunk = (currentChunk + " " + word).trim();
                        }
                    }
                } else {
                    if ((currentChunk + "\n" + paragraph).trim().length > limit) {
                        if (currentChunk.trim()) chunks.push(currentChunk.trim());
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

        // Helper: split text into chunks of <= 500 characters on paragraph/word bounds
        const splitTextIntoThreads = (text, limit = 500) => {
            const hasSeparator = text.includes("---thread-separator---") ||
                                 text.includes("[THREAD_DELIMITER]") ||
                                 /\r?\n---\r?\n/.test(text) ||
                                 /\r?\n---\s*\r?\n/.test(text);
            if (hasSeparator) {
                const regex = /(?:---thread-separator---|\[THREAD_DELIMITER\]|\r?\n---\r?\n|\r?\n---\s*\r?\n)/gi;
                const rawChunks = text.split(regex).map(c => c.trim()).filter(Boolean);
                const finalChunks = [];
                for (const chunk of rawChunks) {
                    if (chunk.length <= limit) {
                        finalChunks.push(chunk);
                    } else {
                        finalChunks.push(...splitParagraphsAndWords(chunk, limit));
                    }
                }
                return finalChunks;
            }
            return splitParagraphsAndWords(text, limit);
        };

        try {
            const chunks = splitTextIntoThreads(post.caption, 500);
            console.log(`[ThreadsPublisher] Caption split into ${chunks.length} thread items.`);
            
            let lastPostId = post.reply_to_id || null;
            let firstPostId = null;
            const threadsAccountId = credentials.account_id || 'me';

            for (let i = 0; i < chunks.length; i++) {
                const chunkText = chunks[i];
                console.log(`[ThreadsPublisher] Publishing chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 30)}..."`);
                
                let containerData = null;
                let containerRes = null;
                let containerCreated = false;
                let retryDelay = 1000;

                // Retry loop for container creation to handle Meta/Threads propagation delay
                // Check if the chunkText contains an image URL (camera emoji + url pattern) or if post.media has an image for Slide 1
                const imgUrlMatch = chunkText.match(/📷\s*(https?:\/\/\S+)/i);
                let hasImage = !!imgUrlMatch;
                let imageUrl = hasImage ? imgUrlMatch[1].trim() : null;

                // Support image on Slide 1 (i === 0) if post has media attached
                let mediaArray = Array.isArray(post.media) && post.media.length > 0 ? post.media : null;
                if (!mediaArray && post.media_urls) {
                    try {
                        const parsed = typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : post.media_urls;
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            mediaArray = parsed;
                        }
                    } catch (_) {}
                }
                if (!mediaArray && post.media_url) {
                    mediaArray = [post.media_url];
                }

                if (!hasImage && i === 0 && mediaArray && mediaArray.length > 0) {
                    const firstMedia = mediaArray[0];
                    let candidateUrl = null;
                    if (typeof firstMedia === 'string') {
                        candidateUrl = firstMedia.trim();
                    } else if (firstMedia && typeof firstMedia === 'object') {
                        // 1. If media has an ID, always prefer the public media endpoint
                        if (firstMedia.id) {
                            candidateUrl = `https://api.socialhub.kwikezee.my/api/media/file?id=${firstMedia.id}`;
                        } else if (firstMedia.url && typeof firstMedia.url === 'string' && firstMedia.url.startsWith('http')) {
                            candidateUrl = firstMedia.url.trim();
                        } else if (firstMedia.public_url && typeof firstMedia.public_url === 'string' && firstMedia.public_url.startsWith('http')) {
                            candidateUrl = firstMedia.public_url.trim();
                        } else if (firstMedia.storage_key && typeof firstMedia.storage_key === 'string' && firstMedia.storage_key.startsWith('http')) {
                            candidateUrl = firstMedia.storage_key.trim();
                        }
                    }

                    if (candidateUrl && typeof candidateUrl === 'string') {
                        candidateUrl = candidateUrl.trim();
                        // Normalize legacy/broken worker domains to the active public API domain
                        if (candidateUrl.includes('socialhub-api.huzaimrosli.workers.dev')) {
                            candidateUrl = candidateUrl.replace(/https?:\/\/socialhub-api\.huzaimrosli\.workers\.dev/g, 'https://api.socialhub.kwikezee.my');
                        }
                        if (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://')) {
                            hasImage = true;
                            imageUrl = candidateUrl;
                        }
                    }
                }

                if (imageUrl && imageUrl.includes('socialhub-api.huzaimrosli.workers.dev')) {
                    imageUrl = imageUrl.replace(/https?:\/\/socialhub-api\.huzaimrosli\.workers\.dev/g, 'https://api.socialhub.kwikezee.my');
                }

                const cleanedText = hasImage && imgUrlMatch ? chunkText.replace(/📷\s*https?:\/\/\S+/gi, '').trim() : chunkText;

                for (let attempt = 1; attempt <= 2; attempt++) {
                    const containerUrl = new URL(`https://graph.threads.net/v1.0/${threadsAccountId}/threads`);
                    if (hasImage && imageUrl) {
                        containerUrl.searchParams.set('media_type', 'IMAGE');
                        containerUrl.searchParams.set('image_url', imageUrl);
                        if (cleanedText) {
                            containerUrl.searchParams.set('text', cleanedText);
                        }
                    } else {
                        containerUrl.searchParams.set('media_type', 'TEXT');
                        containerUrl.searchParams.set('text', chunkText);
                    }
                    containerUrl.searchParams.set('access_token', accessToken);
                    
                    if (lastPostId) {
                        containerUrl.searchParams.set('reply_to_id', lastPostId);
                    }

                    try {
                        containerRes = await fetch(containerUrl.toString(), { 
                            method: 'POST',
                            signal: AbortSignal.timeout(10000)
                        });
                        containerData = await containerRes.json().catch(() => ({}));
                        
                        if (containerRes.ok && containerData.id) {
                            containerCreated = true;
                            break;
                        }
                    } catch (fetchErr) {
                        containerData = { error: { message: fetchErr.message } };
                    }

                    const errMsg = containerData?.error?.message || 'Unknown error';
                    console.warn(`[ThreadsPublisher] Container creation attempt ${attempt} failed for part ${i + 1}: ${errMsg}.`);
                    
                    if (attempt < 2) {
                        console.log(`[ThreadsPublisher] Waiting 1s before retry...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                if (!containerCreated) {
                    console.error(`[ThreadsPublisher] Media container creation failed permanently for part ${i + 1}:`, containerData);
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: null,
                        published_at: null,
                        error_code: 'API_ERROR',
                        error_message: containerData?.error?.message || `Failed to create container for part ${i + 1}.`,
                        retryable: true
                    };
                }

                const containerId = containerData.id;

                // Poll container status to verify it's finished processing before publishing
                // Skip status polling for TEXT-only containers to speed up publication and prevent timeouts
                let isReady = false;
                if (!hasImage) {
                    isReady = true;
                }
                
                let attempts = 0;
                while (!isReady && attempts < 25) {
                    attempts++;
                    const statusRes = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${accessToken}`, {
                        signal: AbortSignal.timeout(8000)
                    });
                    const statusData = await statusRes.json().catch(() => ({}));
                    
                    if (statusData.status === 'FINISHED') {
                        isReady = true;
                        break;
                    } else if (statusData.status === 'ERROR') {
                        console.error(`[ThreadsPublisher] Container failed processing for part ${i + 1}: ${statusData.error_message} (imageUrl: ${imageUrl})`);
                        return {
                            success: false,
                            provider: 'threads',
                            provider_post_id: null,
                            published_at: null,
                            error_code: 'API_ERROR',
                            error_message: statusData.error_message || `Container processing error for part ${i + 1}.`,
                            retryable: false
                        };
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!isReady) {
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: null,
                        published_at: null,
                        error_code: 'TIMEOUT',
                        error_message: `Container for part ${i + 1} remained unfinished after 10 seconds.`,
                        retryable: true
                    };
                }

                let publishData = null;
                let publishRes = null;
                let publishSuccess = false;

                // Retry loop for publication to handle transient Graph API publish timeouts/errors
                for (let attempt = 1; attempt <= 2; attempt++) {
                    const publishUrl = new URL(`https://graph.threads.net/v1.0/${threadsAccountId}/threads_publish`);
                    publishUrl.searchParams.set('creation_id', containerId);
                    publishUrl.searchParams.set('access_token', accessToken);

                    try {
                        publishRes = await fetch(publishUrl.toString(), { 
                            method: 'POST',
                            signal: AbortSignal.timeout(10000)
                        });
                        publishData = await publishRes.json().catch(() => ({}));

                        if (publishRes.ok && publishData.id) {
                            publishSuccess = true;
                            break;
                        }
                    } catch (fetchErr) {
                        publishData = { error: { message: fetchErr.message } };
                    }

                    const errMsg = publishData?.error?.message || 'Unknown error';
                    console.warn(`[ThreadsPublisher] Publication attempt ${attempt} failed for part ${i + 1}: ${errMsg}.`);
                    
                    if (attempt < 2) {
                        console.log(`[ThreadsPublisher] Waiting 1s before retry...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                if (!publishSuccess) {
                    console.error(`[ThreadsPublisher] Container publication failed permanently for part ${i + 1}:`, publishData);
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: null,
                        published_at: null,
                        error_code: 'API_ERROR',
                        error_message: publishData?.error?.message || `Failed to publish part ${i + 1}.`,
                        retryable: true
                    };
                }

                lastPostId = publishData.id;
                if (!firstPostId) {
                    firstPostId = lastPostId;
                }

                // Add a small delay between publications to maintain order on the Threads timeline
                // Reduced from 1.5s to 300ms to allow multi-slide threads to publish within seconds
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
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
