import { AIProvider } from './AIProvider.js';

export class GeminiProvider extends AIProvider {
    constructor(apiKey, model) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        // Use gemini-2.5-flash as default, migrate deprecated gemini-1.5-flash
        let targetModel = model || 'gemini-2.5-flash';
        if (targetModel === 'gemini-1.5-flash') {
            targetModel = 'gemini-2.5-flash';
        }
        this.model = targetModel;
        // Thinking models (Pro and thinking series) need thinkingConfig disabled for structured JSON output
        this.isThinkingModel = targetModel.includes('pro') || targetModel.includes('thinking');
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, isPreset }) {
        const prompt = this.assembleCaptionPrompt({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, isPreset });

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
                    responseMimeType: "application/json",
                    ...(this.isThinkingModel ? { thinkingConfig: { thinkingBudget: 0 } } : {})
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        if (parts.length === 0) {
            throw new Error("Invalid API response format from Gemini.");
        }

        // Scan all parts — thinking models may add thoughtSignature alongside text
        const rawText = (parts.find(p => p.text && !p.thoughtSignature)?.text || parts.find(p => p.text)?.text || "").trim();
        try {
            const parsed = JSON.parse(rawText);
            if (parsed && Array.isArray(parsed.caption)) {
                parsed.caption = parsed.caption.join('---thread-separator---');
            }
            return parsed;
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

    async generateChatResponse(messages) {
        console.log(`[GeminiProvider] Executing chatCompletion with model: ${this.model}`);
        // Map standard assistant role to model for Gemini
        const systemMsg = messages.find(m => m.role === 'system');
        const contents = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));

        const body = { contents };
        if (systemMsg) {
            body.systemInstruction = {
                parts: [{ text: systemMsg.content }]
            };
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini provider error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0 || 
            !data.candidates[0].content || !data.candidates[0].content.parts || 
            data.candidates[0].content.parts.length === 0) {
            throw new Error("Invalid API response format from Gemini.");
        }
        return data.candidates[0].content.parts[0].text;
    }
}

