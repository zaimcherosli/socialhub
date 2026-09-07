import { AIProvider } from './AIProvider.js';

export class OpenAIProvider extends AIProvider {
    constructor(apiKey, model, baseUrl = null) {
        super();
        this.apiKey = apiKey ? apiKey.replace(/^["']|["']$/g, '') : '';
        this.model = model || "gpt-4o-mini";

        const isOfficialOpenAIKey = this.apiKey.startsWith('sk-proj-') || this.apiKey.startsWith('sk-admin-');
        const isAgentRouterKey = (this.apiKey.startsWith('sk-') && !isOfficialOpenAIKey && !this.apiKey.startsWith('sk-or-')) || (baseUrl && baseUrl.includes('agentrouter.org'));
        
        this.isAgentRouter = !!(
            isAgentRouterKey || 
            (baseUrl && baseUrl.includes('agentrouter.org')) || 
            this.model.includes('claude') || 
            this.model.includes('deepseek') || 
            this.model.includes('glm') || 
            this.model.includes('gpt-5.6')
        );

        this.baseUrl = baseUrl || (
            this.isAgentRouter 
                ? "https://agentrouter.org/v1" 
                : "https://api.openai.com/v1"
        );
    }

    // Reasoning models (gpt-5+, o1/o3 family) do NOT support temperature
    isReasoningModel() {
        const m = this.model.toLowerCase();
        return m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') ||
               m.startsWith('gpt-5') || m.includes('gpt-5.');
    }

    async _fetchChatCompletions(payload) {
        const isClaudeModel = this.model.includes('claude-opus') || this.model.includes('claude-');
        const isAgentRouterModel = 
            this.isAgentRouter ||
            this.model.includes('claude-opus') || 
            this.model.includes('deepseek-v4') || 
            this.model.includes('glm-5') || 
            this.model.includes('gpt-5.6');

        // Endpoints to attempt based on model and key type
        const isOpenRouterKey = this.apiKey && this.apiKey.startsWith('sk-or-');
        let endpoints = [];

        if (isOpenRouterKey) {
            endpoints = ["https://openrouter.ai/api/v1/chat/completions"];
        } else if (isAgentRouterModel || this.baseUrl.includes('agentrouter.org')) {
            // Agent Router endpoints — strictly NEVER fallback to api.openai.com (prevents 401 on foreign keys)
            endpoints = isClaudeModel ? [
                "https://agentrouter.org/v1/messages",
                "https://co.agentrouter.org/v1/messages",
                "https://agentrouter.org/v1/chat/completions",
                "https://co.agentrouter.org/v1/chat/completions"
            ] : [
                "https://agentrouter.org/v1/chat/completions",
                "https://co.agentrouter.org/v1/chat/completions",
                "https://agentrouter.org/v1/messages",
                "https://co.agentrouter.org/v1/messages"
            ];
        } else {
            // Direct Official OpenAI platform key
            endpoints = [
                this.baseUrl ? `${this.baseUrl}/chat/completions` : "https://api.openai.com/v1/chat/completions"
            ];
        }

        const uniqueEndpoints = [...new Set(endpoints)];
        let lastErr = null;

        for (const ep of uniqueEndpoints) {
            try {
                const isAnthropicMessages = ep.endsWith('/messages');
                const isAgentRouterEp = ep.includes('agentrouter.org');

                const headers = {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "x-api-key": this.apiKey,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://socialhub.kwikezee.my",
                    "X-Title": "SocialHub"
                };

                if (isAgentRouterEp) {
                    // Claude Code Wire Image headers required by Agent Router Aliyun WAF
                    headers["User-Agent"] = "claude-cli/2.1.158 (external, sdk-cli)";
                    headers["x-app"] = "cli";
                    headers["X-Stainless-Arch"] = "x64";
                    headers["X-Stainless-Lang"] = "js";
                    headers["X-Stainless-OS"] = "Linux";
                    headers["X-Stainless-Package-Version"] = "0.38.0";
                    headers["X-Stainless-Runtime"] = "node";
                    headers["X-Stainless-Runtime-Version"] = "v20.10.0";
                    if (isAnthropicMessages) {
                        headers["anthropic-version"] = "2023-06-01";
                        headers["anthropic-beta"] = "claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24";
                        headers["anthropic-dangerous-direct-browser-access"] = "true";
                    }
                } else {
                    headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
                }

                let requestBody = { ...payload };
                if (isAnthropicMessages) {
                    let anthropicModel = payload.model;
                    if (anthropicModel === 'claude-3.5-sonnet') {
                        anthropicModel = 'claude-3-5-sonnet-20241022';
                    } else if (anthropicModel === 'claude-3.5-haiku') {
                        anthropicModel = 'claude-3-5-haiku-20241022';
                    }
                    // Translate payload to Anthropic /messages format
                    requestBody = {
                        model: anthropicModel,
                        max_tokens: payload.max_tokens || payload.max_completion_tokens || 4096,
                        messages: payload.messages.filter(m => m.role !== 'system'),
                        ...(payload.messages.find(m => m.role === 'system') ? { system: payload.messages.find(m => m.role === 'system').content } : {})
                    };
                } else if (this.isReasoningModel()) {
                    // Reasoning models prefer max_completion_tokens
                    if (!requestBody.max_completion_tokens && !requestBody.max_tokens) {
                        requestBody.max_completion_tokens = 4096;
                    }
                }

                const response = await fetch(ep, {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(requestBody)
                });

                if (response.ok) {
                    const data = await response.json();
                    if (isAnthropicMessages && data.content && Array.isArray(data.content)) {
                        // Extract text cleanly, skipping reasoning/thinking blocks
                        const text = data.content
                            .filter(c => c.type === 'text' || (!c.type && c.text))
                            .map(c => c.text || '')
                            .join('');
                        return {
                            choices: [{ message: { content: text } }]
                        };
                    }
                    return data;
                }
                const errText = await response.text();
                console.error(`[OpenAIProvider] ${ep} error ${response.status}:`, errText);
                lastErr = new Error(`AI API error (${ep}): ${response.status} - ${errText}`);
            } catch (err) {
                console.error(`[OpenAIProvider] ${ep} exception:`, err.message);
                lastErr = err;
            }
        }
        throw lastErr || new Error("Failed to communicate with AI provider.");
    }

    async generateCaption({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, nicheKey, isPreset }) {
        const prompt = this.assembleCaptionPrompt({ businessType, product, targetAudience, goal, tone, language, customInstructions, postFormat, funnelStage, nicheRules, nicheExampleOutput, nicheKey, isPreset });

        const data = await this._fetchChatCompletions({
            model: this.model,
            messages: [
                { role: "user", content: prompt }
            ],
            ...(this.isReasoningModel() ? { max_completion_tokens: 4096 } : { temperature: 0.7, max_tokens: 4096 })
        });

        if (!data.choices || data.choices.length === 0) {
            throw new Error("Invalid API response format from AI provider.");
        }

        const rawText = data.choices[0].message.content.trim();
        
        function extractJsonObj(raw) {
            if (!raw) return null;
            let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            try { return JSON.parse(s); } catch (_) {}
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
            }
            return null;
        }

        const parsed = extractJsonObj(rawText);
        if (parsed) {
            if (Array.isArray(parsed.caption)) {
                parsed.caption = parsed.caption.join('---thread-separator---');
            }
            return parsed;
        }

        console.warn("Failed to parse OpenAI output as JSON, returning raw text:", rawText);
        return {
            caption: rawText,
            cta: "",
            hashtags: []
        };
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

        const data = await this._fetchChatCompletions({
            model: this.model,
            messages: [
                { role: "user", content: prompt }
            ],
            ...(this.isReasoningModel() ? {} : { temperature: 0.7 })
        });

        if (!data.choices || data.choices.length === 0) {
            throw new Error("Invalid API response format from AI provider.");
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
        const data = await this._fetchChatCompletions({
            model: this.model,
            messages: messages,
            ...(this.isReasoningModel() ? {} : { temperature: 0.7 })
        });
        return data.choices[0].message.content;
    }
}

