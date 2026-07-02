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

IMPORTANT: The generated caption MUST be under 350 characters to ensure the total post length including CTA and hashtags stays strictly under 500 characters.

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

    async generateThreadStorm({ title, description, url, tone, language, customInstructions }) {
        let prompt = `You are an expert social media copywriter specializing in Malaysian Malay (Bahasa Melayu Malaysia).
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
6. Provide relevant local hashtags.`;

        if (customInstructions && customInstructions.trim() !== '') {
            prompt += `\n7. CRITICAL CUSTOM RULES & GUIDELINES: You MUST follow these specific instructions for hooks, content flow, tone, and CTA layout. Adhere to this strictly:\n${customInstructions}`;
        }

        prompt += `\n\nOutput Format:
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
            console.error("Failed to parse Gemini thread storm output as JSON:", rawText);
            return {
                title: title,
                threads: [rawText],
                cta: "",
                hashtags: []
            };
        }
    }
}
