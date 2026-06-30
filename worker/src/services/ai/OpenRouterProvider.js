import { AIProvider } from './AIProvider.js';

export class OpenRouterProvider extends AIProvider {
    constructor(apiKey, model) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        this.model = model || "meta-llama/llama-3.2-3b-instruct:free";
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

Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:
{
  "caption": "write the main post caption here, engaging and optimized for the specified tone",
  "cta": "write a strong call-to-action",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://socialhub.zaimrosli.my",
                "X-Title": "SocialHub"
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "user", content: prompt }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            throw new Error("Invalid API response format from OpenRouter.");
        }

        const rawText = data.choices[0].message.content.trim();
        
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
            console.error("Failed to parse AI output as JSON:", rawText);
            return {
                caption: rawText,
                cta: "",
                hashtags: []
            };
        }
    }
}
