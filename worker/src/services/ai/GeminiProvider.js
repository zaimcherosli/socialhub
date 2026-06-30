import { AIProvider } from './AIProvider.js';

export class GeminiProvider extends AIProvider {
    constructor(apiKey, model) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        // Auto-migrate deprecated models to gemini-2.5-flash
        let targetModel = model || 'gemini-2.5-flash';
        if (targetModel.includes('gemini-2.0-flash') || targetModel.includes('gemini-1.5-flash')) {
            if (!targetModel.includes('/')) {
                targetModel = 'gemini-2.5-flash';
            }
        }
        this.model = targetModel;
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

Provide the output in a strict JSON format with the following keys:
{
  "caption": "write the main post caption here, engaging and optimized for the specified tone",
  "cta": "write a strong call-to-action",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0 || 
            !data.candidates[0].content || !data.candidates[0].content.parts || 
            data.candidates[0].content.parts.length === 0) {
            throw new Error("Invalid API response format from Gemini.");
        }

        const rawText = data.candidates[0].content.parts[0].text.trim();
        try {
            return JSON.parse(rawText);
        } catch (e) {
            console.error("Failed to parse Gemini output as JSON:", rawText);
            return {
                caption: rawText,
                cta: "",
                hashtags: []
            };
        }
    }
}
