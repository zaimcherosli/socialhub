/**
 * SharedImageGenerationService.js
 * Shared image provider cascade for SocialHub AI image generation.
 * Coordinates execution across OpenAI / AgentRouter, Cloudflare Workers AI, and Unsplash fallback,
 * and persists generated data URLs into the D1 media library.
 * 
 * Reused by:
 * 1. Legacy /api/ai/generate-image (preserves existing copywriting prompt synthesis)
 * 2. Creative Studio /api/creative/generate-visual (consumes pure visual asset prompts)
 */

export class SharedImageGenerationService {
    /**
     * Parse binary/base64 response from Cloudflare Workers AI
     */
    static async parseCloudflareImageResponse(res) {
        if (!res) return null;
        if (res.image && typeof res.image === 'string') {
            return res.image;
        }
        if (typeof res === 'string') {
            return res.startsWith('data:') ? res.split(',')[1] : res;
        }
        try {
            const bytes = new Uint8Array(await new Response(res).arrayBuffer());
            let binary = '';
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const b64 = btoa(binary);
            if (b64 === 'W29iamVjdCBPYmplY3Rd') return null;
            return b64;
        } catch (_) {
            return null;
        }
    }

    /**
     * Execute the unified multi-provider image generation cascade
     * 
     * @param {object} options
     * @param {object} options.env - Cloudflare worker environment bindings (AI, DB, etc.)
     * @param {number} options.userId - User ID for media record persistence
     * @param {number} options.workspaceId - Workspace ID for tenancy isolation
     * @param {string} options.visualPrompt - Prepared prompt string to submit to models
     * @param {string} [options.quality='standard'] - 'low' | 'standard' | 'medium' | 'high' | 'hd'
     * @param {string} [options.openaiApiKey=''] - OpenAI / AgentRouter API key
     * @param {string} [options.requestOrigin=''] - Base URL for media file serving
     * @returns {Promise<{ success: boolean, image_url: string, source: string, openai_error: string|null }>}
     */
    static async generateImage({
        env,
        userId,
        workspaceId,
        visualPrompt,
        quality = 'standard',
        openaiApiKey = '',
        requestOrigin = '',
        allowStockFallback = false
    }) {
        const imgQuality = (quality || 'standard').toLowerCase();
        let imageUrl = null;
        let usedSource = 'none';
        let openAiErrDetail = null;

        // 1. If quality is 'low', prefer Cloudflare Workers AI (FLUX.1 Schnell or SDXL)
        if (imgQuality === 'low' && env && env.AI) {
            try {
                let rawRes = null;
                try {
                    rawRes = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: visualPrompt.slice(0, 500) });
                } catch (_) {
                    rawRes = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', { prompt: visualPrompt });
                }
                const base64 = await this.parseCloudflareImageResponse(rawRes);
                if (base64) {
                    imageUrl = `data:image/jpeg;base64,${base64}`;
                    usedSource = 'cloudflare-flux';
                }
            } catch (cfErr) {
                console.error('[Cloudflare AI Image Error for Low Quality]:', cfErr);
            }
        }

        // 2. OpenAI / Agent Router Image Models Cascade (gpt-image-2 -> dall-e-3 -> dall-e-2)
        if (!openaiApiKey) {
            console.warn('[SharedImageGeneration] OPENAI_API_KEY is not configured.');
            openAiErrDetail = 'API key OpenAI / Agent Router tidak ditemui atau gagal didekripsi.';
        } else if (!imageUrl) {
            const candidateModels = ['gpt-image-2', 'dall-e-3', 'dall-e-2'];
            const candidateEndpoints = [
                'https://agentrouter.org/v1/images/generations',
                'https://api.openai.com/v1/images/generations'
            ];

            for (const modelName of candidateModels) {
                if (imageUrl) break;
                for (const ep of candidateEndpoints) {
                    if (imageUrl) break;
                    try {
                        console.log(`[SharedImageGeneration] Attempting image generation with model: ${modelName} on ${ep}...`);
                        const payload = {
                            model: modelName,
                            prompt: visualPrompt.slice(0, 1000),
                            n: 1,
                            size: '1024x1024'
                        };
                        if (modelName === 'dall-e-3') {
                            payload.quality = (imgQuality === 'high' || imgQuality === 'hd') ? 'hd' : 'standard';
                        }

                        const isAgentRouter = ep.includes('agentrouter.org');
                        const headers = {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${openaiApiKey}`,
                            'x-api-key': openaiApiKey,
                            'HTTP-Referer': 'https://socialhub.kwikezee.my',
                            'X-Title': 'SocialHub'
                        };
                        if (isAgentRouter) {
                            headers['User-Agent'] = 'claude-cli/2.1.158 (external, sdk-cli)';
                            headers['anthropic-version'] = '2023-06-01';
                            headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24';
                            headers['anthropic-dangerous-direct-browser-access'] = 'true';
                            headers['x-app'] = 'cli';
                            headers['X-Stainless-Arch'] = 'x64';
                            headers['X-Stainless-Lang'] = 'js';
                            headers['X-Stainless-OS'] = 'Linux';
                            headers['X-Stainless-Package-Version'] = '0.38.0';
                            headers['X-Stainless-Runtime'] = 'node';
                            headers['X-Stainless-Runtime-Version'] = 'v20.10.0';
                        } else {
                            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
                        }

                        const openAiRes = await fetch(ep, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(payload)
                        });

                        if (openAiRes.ok) {
                            const data = await openAiRes.json();
                            if (data.data && data.data[0]) {
                                if (data.data[0].b64_json) {
                                    imageUrl = `data:image/jpeg;base64,${data.data[0].b64_json}`;
                                } else if (data.data[0].url) {
                                    imageUrl = data.data[0].url;
                                }
                                usedSource = `openai-${modelName}`;
                                openAiErrDetail = null;
                                console.log(`[SharedImageGeneration] Success with model: ${modelName} on ${ep}`);
                                break;
                            }
                        } else {
                            const errText = await openAiRes.text();
                            console.warn(`[Image Generation Error for ${modelName} on ${ep} HTTP ${openAiRes.status}]:`, errText);
                            try {
                                const parsedErr = JSON.parse(errText);
                                openAiErrDetail = parsedErr.error?.message || errText;
                            } catch (_) {
                                openAiErrDetail = errText;
                            }
                        }
                    } catch (oaiErr) {
                        console.warn(`[Image Generation Fetch Error for ${modelName} on ${ep}]:`, oaiErr);
                        openAiErrDetail = oaiErr.message;
                    }
                }
            }
        }

        // 3. Fallback: If OpenAI/AgentRouter failed, fall back to Cloudflare Workers AI (FLUX.1 Schnell or SDXL)
        if (!imageUrl && env && env.AI) {
            try {
                let rawRes = null;
                try {
                    rawRes = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: visualPrompt.slice(0, 500) });
                } catch (_) {
                    rawRes = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', { prompt: visualPrompt });
                }
                const base64 = await this.parseCloudflareImageResponse(rawRes);
                if (base64) {
                    imageUrl = `data:image/jpeg;base64,${base64}`;
                    usedSource = 'cloudflare-flux';
                    openAiErrDetail = null;
                }
            } catch (cfErr) {
                console.error('[Cloudflare AI Image Error Fallback]:', cfErr);
            }
        }

        // 4. Stock Fallback Handling
        if (!imageUrl) {
            if (!allowStockFallback) {
                const errDetail = openAiErrDetail ? ` Reason: ${openAiErrDetail}` : '';
                const err = new Error(`Creative visual generation failed: All configured AI image providers failed.${errDetail} Stock fallback is disabled for Creative Studio brand visuals.`);
                err.statusCode = 502;
                throw err;
            }

            imageUrl = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80';
            usedSource = 'unsplash-fallback';
        }

        let publicUrl = imageUrl;

        // 5. Store base64 data URLs in D1 media table
        if (env && env.DB && imageUrl && imageUrl.startsWith('data:')) {
            try {
                const ext = imageUrl.includes('png') ? 'png' : 'jpg';
                const mime = imageUrl.includes('png') ? 'image/png' : 'image/jpeg';
                const filename = `ai_generated_${Date.now()}.${ext}`;
                const result = await env.DB.prepare(
                    `INSERT INTO media (user_id, workspace_id, filename, original_name, mime_type, file_size, width, height, storage_provider, storage_key, thumbnail) 
                     VALUES (?, ?, ?, ?, ?, 0, 1024, 1024, 'local', ?, NULL)`
                ).bind(userId, workspaceId, filename, filename, mime, imageUrl).run();

                const newMediaId = result.meta.last_row_id;
                const baseUrl = requestOrigin ? requestOrigin.replace(/\/$/, '') : 'https://socialhub-api.huzaimrosli.workers.dev';
                publicUrl = `${baseUrl}/api/media/file?id=${newMediaId}`;
            } catch (saveErr) {
                console.error('[Media Save Error]:', saveErr);
            }
        }

        return {
            success: true,
            image_url: publicUrl,
            source: usedSource,
            openai_error: openAiErrDetail
        };
    }
}
