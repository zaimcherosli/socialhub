import { AIProvider } from './AIProvider.js';

export class OpenRouterProvider extends AIProvider {
    constructor(apiKey, model) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        this.model = model || "meta-llama/llama-3.2-3b-instruct:free";
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage }) {
        let prompt = `You are a social media copywriter.
Write a highly engaging social media post based on these details:
- Topic/Category: ${businessType}
- Content Focus: ${product}
- Target Audience: ${targetAudience}
- Goal: ${goal}
- Tone: ${tone}
- Language: ${language}
`;

        if (funnelStage === 'tofu') {
            prompt += `- Funnel Stage: TOFU (Top of Funnel - Awareness). Focus on educating, sharing high-level value tips, general trends, or answering common questions. Keep it highly shareable, easy to understand, and do NOT make a hard sell.\n`;
        } else if (funnelStage === 'mofu') {
            prompt += `- Funnel Stage: MOFU (Middle of Funnel - Consideration). Focus on building trust, authority, solving specific pain points, comparison guides, checklists, or pros & cons related to the product/service.\n`;
        } else if (funnelStage === 'bofu') {
            prompt += `- Funnel Stage: BOFU (Bottom of Funnel - Conversion). Focus on driving direct action, conversion, highlighting specific offers, promotional benefits, urgency, or testimonials. The CTA must be very strong and invite them to act now (e.g. WhatsApp, direct sign-up, or click a link).\n`;
        }

        if (postFormat === 'thread') {
            prompt += `- Format: Thread / Bebenang Berangkai. You MUST generate a sequence of exactly 4 to 5 connected slides/posts. The "caption" key in the JSON output MUST be a JSON array of strings containing these 4 to 5 slides in order. Each individual slide/post string in the array must be under 300 characters.\n`;
        } else {
            prompt += `- Format: Single standalone post. The caption must be under 350 characters.\n`;
        }

        prompt += `\n`;

        if (customInstructions) {
            prompt += `Follow these copywriting guidelines closely:\n${customInstructions}\n\n`;
        }

        if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
            prompt += `CRITICAL MALAYSIAN CONVERSATIONAL RULES:
1. Write like a real human posting on Threads or Instagram. Do NOT sound like a marketer, corporate bot, or formal translator.
2. Avoid generic marketing phrases (e.g. do NOT use "Mari mulakan...", "Jangan lepaskan peluang...", "Semoga hari ini membawa keberkatan...").
3. Use natural Malaysian conversational speech (Bahasa Melayu rojak / colloquial speech). Use local words/contractions naturally: 'je', 'lah', 'tau', 'ni', 'nak', 'korang', 'weyy'.
4. For Islamic content (selawat/zikir), keep the tone gentle, personal, and friendly—like a close friend giving a gentle reminder.
5. The Call to Action (cta) must NOT be promotional (e.g. avoid "Klik link di bio"). Instead, write a conversational CTA to get comments/replies, like a question or friendly prompt (e.g. "Korang dah selawat ke hari ni? Jom kongsi kat bawah 👇" or "Salam Jumaat korang. Dah bersedia untuk solat?").
`;
        } else {
            prompt += `GUIDELINES:
1. Write in a natural, human tone matching the specified tone of voice.
2. The CTA should be highly engaging and relevant to the post's goal.
`;
        }

        let jsonStructure = "";
        if (postFormat === 'thread') {
            jsonStructure = `{
  "caption": [
    "Slide 1 content under 300 characters",
    "Slide 2 content under 300 characters",
    "Slide 3 content under 300 characters",
    "Slide 4 content under 300 characters",
    "Slide 5 content under 300 characters"
  ],
  "cta": "write the call-to-action here",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;
        } else {
            jsonStructure = `{
  "caption": "write the main post caption here",
  "cta": "write the call-to-action here",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;
        }

        prompt += `\nProvide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:\n${jsonStructure}`;

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
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && Array.isArray(parsed.caption)) {
                parsed.caption = parsed.caption.join('---thread-separator---');
            }
            return parsed;
        } catch (e) {
            console.error("Failed to parse AI output as JSON:", rawText);
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
            console.error("Failed to parse OpenRouter thread storm output as JSON:", rawText);
            return {
                title: title,
                threads: [rawText],
                cta: "",
                hashtags: []
            };
        }
    }

    async generateChatResponse(messages) {
        console.log(`[OpenRouterProvider] Executing chatCompletion with model: ${this.model}`);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
            throw new Error(`OpenRouter provider error: ${response.status} - ${errText}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}

