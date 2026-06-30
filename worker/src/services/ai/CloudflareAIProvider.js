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

    async generateCaption({ businessType, product, targetAudience, goal, tone, language }) {
        console.log(`[CloudflareAIProvider] Executing run with model: ${this.model}`);
        const response = await this.ai.run(this.model, {
            messages: [
                {
                    role: "system",
                    content: "You are a professional social media marketing expert. You must write a high-converting, engaging social media post and return the output strictly in JSON format. Do not return any markdown wrappers, explanation, or other text. IMPORTANT: If the output language is Malay, you MUST write in standard Malaysian Malay (Bahasa Melayu Malaysia) for a local Malaysian audience. Strictly avoid Indonesian slang/vocabulary (e.g. use 'dipercayai' instead of 'terpercaya', 'tawaran' instead of 'penawaran', 'boleh' instead of 'bisa', 'perlu' instead of 'butuh', 'pelanggan' instead of 'nasabah'). IMPORTANT: The generated caption MUST be under 350 characters to ensure the total post length including CTA and hashtags stays strictly under 500 characters."
                },
                {
                    role: "user",
                    content: `Write a social media post based on these details:
- Business Type: ${businessType}
- Product / Service: ${product}
- Target Audience: ${targetAudience}
- Goal: ${goal}
- Tone of Voice: ${tone}
- Language: ${language}

Provide the output in a strict JSON format matching this schema:
{
  "caption": "write the main post caption here, engaging and optimized for the specified tone",
  "cta": "write a strong call-to-action",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`
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
}
