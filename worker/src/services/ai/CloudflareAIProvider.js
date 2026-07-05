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

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions }) {
        console.log(`[CloudflareAIProvider] Executing run with model: ${this.model}`);
        
        let systemPrompt = "You are a professional social media copywriter. You must write an engaging post and return the output strictly in JSON format. Do not return any markdown wrappers, explanation, or other text. IMPORTANT: The generated caption MUST be under 350 characters.";
        if (customInstructions) {
            systemPrompt += `\nFollow these copywriting guidelines closely:\n${customInstructions}`;
        }
        let userPrompt = `Write a social media post based on these details:
- Topic/Category: ${businessType}
- Content Focus: ${product}
- Target Audience: ${targetAudience}
- Goal: ${goal}
- Tone: ${tone}
- Language: ${language}

Provide the output in a strict JSON format matching this schema:
{
  "caption": "write the main post caption here",
  "cta": "write the call-to-action here",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
            systemPrompt += ` CRITICAL MALAYSIAN CONVERSATIONAL RULES:
1. Write like a real human posting on Threads or Instagram. Do NOT sound like a marketer, corporate bot, or formal translator.
2. Avoid generic marketing phrases (e.g. do NOT use "Mari mulakan...", "Jangan lepaskan peluang...", "Semoga hari ini membawa keberkatan...").
3. Use natural Malaysian conversational speech (Bahasa Melayu rojak / colloquial speech). Use local words/contractions naturally: 'je', 'lah', 'tau', 'ni', 'nak', 'korang', 'weyy'.
4. For Islamic content (selawat/zikir), keep the tone gentle, personal, and friendly—like a close friend giving a gentle reminder.
5. The Call to Action (cta) must NOT be promotional (e.g. avoid "Klik link di bio"). Instead, write a conversational CTA to get comments/replies, like a question or friendly prompt (e.g. "Korang dah selawat ke hari ni? Jom kongsi kat bawah 👇" or "Salam Jumaat korang. Dah bersedia untuk solat?").`;
        }

        const response = await this.ai.run(this.model, {
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userPrompt
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
            return JSON.parse(jsonStr.trim());
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
5. Provide a strong Call to Action (CTA) pointing to the product/video link.
6. Provide relevant local hashtags.

Output Format:
Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:
{
  "title": "A catchy title for the thread storm",
  "threads": [
    "Thread 1 content...",
    "Thread 2 content..."
  ],
  "cta": "Click the link to check it out: ${url}",
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

