import { AIProvider } from './AIProvider.js';

export class CloudflareAIProvider extends AIProvider {
    constructor(aiBinding, model) {
        super();
        this.ai = aiBinding;
        
        // Auto-migrate deprecated models to llama-3.2-3b-instruct
        let targetModel = model || '@cf/meta/llama-3.2-3b-instruct';
        const deprecatedModels = [
            '@cf/meta/llama-3-8b-instruct',
            '@cf/meta/llama-3.1-8b-instruct',
            '@cf/meta/llama-3.1-8b-instruct-awq'
        ];
        if (deprecatedModels.includes(targetModel)) {
            targetModel = '@cf/meta/llama-3.2-3b-instruct';
        }
        this.model = targetModel;
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, isPreset }) {
        console.log(`[CloudflareAIProvider] Executing run with model: ${this.model}`);
        const prompt = this.assembleCaptionPrompt({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, isPreset });

        const response = await this.ai.run(this.model, {
            messages: [
                {
                    role: "system",
                    content: "You are a professional social media copywriting assistant. You must write an engaging post and return the output strictly in JSON format. Do not return any markdown wrappers, explanation, or other text."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        console.log(`[CloudflareAIProvider] Raw response:`, JSON.stringify(response, null, 2));

        let rawText = "";
        let parsedResult = null;

        if (response.response && typeof response.response === 'object') {
            parsedResult = response.response;
        } else if (response.response) {
            rawText = response.response;
        } else if (response.choices && response.choices[0]) {
            const msg = response.choices[0].message;
            if (msg && msg.content) {
                if (typeof msg.content === 'object') {
                    parsedResult = msg.content;
                } else {
                    rawText = msg.content;
                }
            } else if (response.choices[0].text) {
                if (typeof response.choices[0].text === 'object') {
                    parsedResult = response.choices[0].text;
                } else {
                    rawText = response.choices[0].text;
                }
            }
        } else if (response.result && response.result.response) {
            if (typeof response.result.response === 'object') {
                parsedResult = response.result.response;
            } else {
                rawText = response.result.response;
            }
        }

        if (parsedResult) {
            if (parsedResult && Array.isArray(parsedResult.caption)) {
                parsedResult.caption = parsedResult.caption.join('---thread-separator---');
            }
            return {
                caption: parsedResult.caption || "",
                cta: parsedResult.cta || "",
                hashtags: parsedResult.hashtags || []
            };
        }

        if (!rawText) {
            throw new Error("Could not extract text response from Cloudflare Workers AI payload.");
        }

        rawText = rawText.trim();
        let jsonStr = rawText;
        if (jsonStr.startsWith("```json")) {
            jsonStr = jsonStr.substring(7);
        } else if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr.substring(3);
        }
        if (jsonStr.endsWith("```")) {
            jsonStr = jsonStr.substring(0, jsonStr.length - 3);
        }

        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && Array.isArray(parsed.caption)) {
                parsed.caption = parsed.caption.join('---thread-separator---');
            }
            return parsed;
        } catch (e) {
            console.error("Failed to parse Cloudflare AI output as JSON:", rawText);
            return {
                caption: rawText,
                cta: "",
                hashtags: []
            };
        }
    }

    async generateThreadStorm({ title, description, url, tone, language }) {
        const prompt = `You are an expert social media copywriter specializing in Malaysian Malay (Bahasa Melayu Malaysia).
Your task is to write an engaging, high-converting social media thread storm (suitable for Threads platform) based on a product or video link.

Details:
- Product/Video Title: ${title}
- Product/Video Description: ${description}
- Reference URL: ${url}

Guidelines:
1. Write in natural, trendy Malaysian Malay (Bahasa Melayu Malaysia). Do NOT use Indonesian words (like 'bisa', 'kamu', 'ingin', 'yuk', 'butuh'). Use native Malaysian slangs or standard BM correctly (e.g. 'boleh', 'nak', 'perlu', 'korang').
2. Since Threads allows multiple posts in a single thread (thread storm), divide the copywriting into sequential steps/points (e.g. introduction, key features, benefits, problem solved).
3. Return each section as a separate thread post.
4. Each thread post MUST be under 450 characters.
5. Provide a very casual, non-pushy, laid-back Malaysian conversational redirect phrase pointing to the link (e.g. "Nah link kalau ada yang nak ushar:", "Korang ushar sendiri kat sini:", "Kot lah ada yang nak tengok:"). Avoid pushy sales pitches like "Beli sekarang!" or "Dapatkan segera!".
6. Provide relevant local hashtags.
7. HOOK VARIATION: Ensure the very first sentence (hook) of the thread is highly diverse. Do NOT start with the repetitive "Pernah tak...?" or "Korang tahu tak...?" question pattern. Instead, start with a direct statement, interesting reflection, or natural observation (e.g., "Benda paling leceh bila...", "Ramai tak perasan...", "Aku baru try...").

Output Format:
Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:
{
  "title": "A catchy title for the thread storm",
  "threads": [
    "Thread 1 content...",
    "Thread 2 content..."
  ],
  "cta": "Nah link kalau nak ushar:",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        console.log(`[CloudflareAIProvider] Executing generateThreadStorm with model: ${this.model}`);
        const response = await this.ai.run(this.model, {
            messages: [
                {
                    role: "system",
                    content: "You are a professional social media marketing expert. You must write a high-converting, engaging social media post and return the output strictly in JSON format. Do not return any markdown wrappers, explanation, or other text."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        let rawText = "";
        let parsedResult = null;

        if (response.response && typeof response.response === 'object') {
            parsedResult = response.response;
        } else if (response.response) {
            rawText = response.response;
        } else if (response.choices && response.choices[0]) {
            const msg = response.choices[0].message;
            if (msg && msg.content) {
                if (typeof msg.content === 'object') {
                    parsedResult = msg.content;
                } else {
                    rawText = msg.content;
                }
            } else if (response.choices[0].text) {
                if (typeof response.choices[0].text === 'object') {
                    parsedResult = response.choices[0].text;
                } else {
                    rawText = response.choices[0].text;
                }
            }
        }

        if (parsedResult) {
            return {
                title: parsedResult.title || title,
                threads: parsedResult.threads || [parsedResult.caption || ""],
                cta: parsedResult.cta || "",
                hashtags: parsedResult.hashtags || []
            };
        }

        if (!rawText) {
            throw new Error("Could not extract text response from Cloudflare Workers AI payload.");
        }

        rawText = rawText.trim();
        let jsonStr = rawText;
        if (jsonStr.startsWith("```json")) {
            jsonStr = jsonStr.substring(7);
        } else if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr.substring(3);
        }
        if (jsonStr.endsWith("```")) {
            jsonStr = jsonStr.substring(0, jsonStr.length - 3);
        }

        try {
            return JSON.parse(jsonStr.trim());
        } catch (e) {
            console.error("Failed to parse Cloudflare thread storm as JSON:", rawText);
            return {
                title: title,
                threads: [rawText],
                cta: "",
                hashtags: []
            };
        }
    }

    async generateChatResponse(messages) {
        console.log(`[CloudflareAIProvider] Executing chatCompletion with model: ${this.model}`);
        const res = await this.ai.run(this.model, { messages });
        if (typeof res === 'string') return res;
        if (res.response) return res.response;
        if (res.choices && res.choices[0] && res.choices[0].message) {
            return res.choices[0].message.content;
        }
        throw new Error("Invalid Cloudflare AI response");
    }
}

