import { AIProvider } from './AIProvider.js';

export class CloudflareAIProvider extends AIProvider {
    constructor(aiBinding) {
        super();
        this.ai = aiBinding;
        this.model = '@cf/meta/llama-3-8b-instruct';
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language }) {
        const prompt = `You are a professional social media marketing expert.
Write a high-converting, engaging social media post based on the following details:
- Business Type: ${businessType}
- Product / Service: ${product}
- Target Audience: ${targetAudience}
- Goal: ${goal}
- Tone of Voice: ${tone}
- Language: ${language}

Provide the output in a strict JSON format with the following keys. Do not return any other text, markdown blocks, or explanation:
{
  "caption": "write the main post caption here, engaging and optimized for the specified tone",
  "cta": "write a strong call-to-action",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        const response = await this.ai.run(this.model, {
            prompt: prompt
        });

        if (!response || !response.response) {
            throw new Error("Invalid response received from Cloudflare Workers AI.");
        }

        const rawText = response.response.trim();
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
