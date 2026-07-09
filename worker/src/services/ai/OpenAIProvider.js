import { AIProvider } from './AIProvider.js';

export class OpenAIProvider extends AIProvider {
    constructor(apiKey, model) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        this.model = model || "gpt-4o-mini";
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput }) {
        const prompt = this.assembleCaptionPrompt({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput });

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
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
            throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            throw new Error("Invalid API response format from OpenAI.");
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
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && Array.isArray(parsed.caption)) {
                parsed.caption = parsed.caption.join('---thread-separator---');
            }
            return parsed;
        } catch (e) {
            console.error("Failed to parse OpenAI output as JSON:", rawText);
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
5. Provide a very casual, non-pushy, laid-back Malaysian conversational redirect phrase pointing to the link (e.g. "Nah link kalau ada yang nak ushar:", "Korang ushar sendiri kat sini:", "Kot lah ada yang nak tengok:"). Avoid pushy sales pitches like "Beli sekarang!" or "Dapatkan segera!".
6. Provide relevant local hashtags.
7. HOOK VARIATION: Ensure the very first sentence (hook) of the thread is highly diverse. Do NOT start with the repetitive "Pernah tak...?" or "Korang tahu tak...?" question pattern. Instead, start with a direct statement, interesting reflection, or natural observation (e.g., "Benda paling leceh bila...", "Ramai tak perasan...", "Aku baru try...").`;

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
  "cta": "Nah link kalau nak ushar:",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
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
            throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            throw new Error("Invalid API response format from OpenAI.");
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
            console.error("Failed to parse OpenAI thread storm as JSON:", rawText);
            return {
                title: title,
                threads: [rawText],
                cta: "",
                hashtags: []
            };
        }
    }

    async generateChatResponse(messages) {
        console.log(`[OpenAIProvider] Executing chatCompletion with model: ${this.model}`);
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                temperature: 0.7
            })
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI provider error: ${response.status} - ${errText}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}

