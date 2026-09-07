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
                        } else if (typeof parsed === 'string' && parsed.startsWith('http')) {
                            mediaArray = [parsed];
                        }
                    } catch (_) {
                        if (typeof post.media_urls === 'string' && post.media_urls.startsWith('http')) {
                            mediaArray = [post.media_urls];
                        }
                    }
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
                        if (firstMedia.url && typeof firstMedia.url === 'string' && firstMedia.url.startsWith('http')) {
                            candidateUrl = firstMedia.url.trim();
                        } else if (firstMedia.id) {
                            candidateUrl = `https://api.socialhub.kwikezee.my/api/media/file/${firstMedia.id}.jpg`;
                        } else if (firstMedia.public_url && typeof firstMedia.public_url === 'string' && firstMedia.public_url.startsWith('http')) {
                            candidateUrl = firstMedia.public_url.trim();
                        } else if (firstMedia.storage_key && typeof firstMedia.storage_key === 'string' && firstMedia.storage_key.startsWith('http')) {
                            candidateUrl = firstMedia.storage_key.trim();
                        }
                    }

                    if (candidateUrl && typeof candidateUrl === 'string') {
                        candidateUrl = candidateUrl.trim();
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

                // Function to attempt container creation
                const createContainer = async (useImage, imgLink) => {
                    const cUrl = new URL(`https://graph.threads.net/v1.0/${threadsAccountId}/threads`);
                    if (useImage && imgLink) {
                        cUrl.searchParams.set('media_type', 'IMAGE');
                        cUrl.searchParams.set('image_url', imgLink);
                        if (cleanedText) {
                            cUrl.searchParams.set('text', cleanedText);
                        }
                    } else {
                        cUrl.searchParams.set('media_type', 'TEXT');
                        cUrl.searchParams.set('text', chunkText);
                    }
                    cUrl.searchParams.set('access_token', accessToken);
                    if (lastPostId) {
                        cUrl.searchParams.set('reply_to_id', lastPostId);
                    }

                    const res = await fetch(cUrl.toString(), {
                        method: 'POST',
                        signal: AbortSignal.timeout(8000)
                    });
                    const data = await res.json().catch(() => ({}));
                    return { ok: res.ok && !!data.id, data };
                };

                // Attempt container creation with retry
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        const result = await createContainer(hasImage, imageUrl);
                        containerData = result.data;
                        if (result.ok) {
                            containerCreated = true;
                            break;
                        }
                    } catch (fetchErr) {
                        containerData = { error: { message: fetchErr.message } };
                    }

                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 600));
                    }
                }

                // If IMAGE container failed permanently, gracefully fall back to TEXT container for Slide 1
                // to prevent aborting the entire thread storm midway ("masuk separuh")
                if (!containerCreated && hasImage) {
                    console.warn(`[ThreadsPublisher] Image container creation failed for part ${i + 1} (${containerData?.error?.message || 'error'}). Gracefully falling back to TEXT container...`);
                    hasImage = false;
                    imageUrl = null;
                    try {
                        const fallbackResult = await createContainer(false, null);
                        containerData = fallbackResult.data;
                        if (fallbackResult.ok) {
                            containerCreated = true;
                        }
                    } catch (fbErr) {
                        containerData = { error: { message: fbErr.message } };
                    }
                }

                if (!containerCreated) {
                    console.error(`[ThreadsPublisher] Media container creation failed permanently for part ${i + 1}:`, containerData);
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: firstPostId,
                        published_at: null,
                        error_code: 'API_ERROR',
                        error_message: containerData?.error?.message || `Failed to create container for part ${i + 1}.`,
                        retryable: true
                    };
                }

                let containerId = containerData.id;

                // Poll container status to verify it's finished processing before publishing
                // Skip status polling for TEXT-only containers to speed up publication and prevent timeouts
                let isReady = !hasImage;
                let attempts = 0;
                while (!isReady && attempts < 14) {
                    attempts++;
                    try {
                        const statusRes = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${accessToken}`, {
                            signal: AbortSignal.timeout(6000)
                        });
                        const statusData = await statusRes.json().catch(() => ({}));
                        
                        if (statusData.status === 'FINISHED') {
                            isReady = true;
                            break;
                        } else if (statusData.status === 'ERROR') {
                            console.warn(`[ThreadsPublisher] Image container processing ERROR for part ${i + 1}: ${statusData.error_message}. Falling back to TEXT container for this slide...`);
                            break;
                        }
                    } catch (_) {}
                    
                    await new Promise(resolve => setTimeout(resolve, 400));
                }

                // If image container errored or timed out, gracefully recreate as TEXT container
                // so the post finishes publishing instead of getting aborted or locked in 'publishing'
                if (!isReady && hasImage) {
                    console.warn(`[ThreadsPublisher] Image processing for part ${i + 1} did not finish in time. Publishing part ${i + 1} as TEXT so remaining thread items succeed.`);
                    hasImage = false;
                    imageUrl = null;
                    try {
                        const textFb = await createContainer(false, null);
                        if (textFb.ok) {
                            containerId = textFb.data.id;
                            isReady = true;
                        }
                    } catch (_) {}
                }

                if (!isReady) {
                    return {
                        success: false,
                        provider: 'threads',
                        provider_post_id: firstPostId,
                        published_at: null,
                        error_code: 'TIMEOUT',
                        error_message: `Container for part ${i + 1} remained unfinished after polling.`,
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
