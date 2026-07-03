export class AutopilotService {
    constructor(provider) {
        this.provider = provider;
    }

    async generateAutopilotCampaign({ niche, targetAudience, platform, count, language, timezoneOffset, frequency }) {
        console.log(`[AutopilotService] Starting autopilot campaign generation for niche: "${niche}", count: ${count}, frequency: ${frequency}`);

        // Custom prompt requesting a JSON array of posts
        const prompt = `You are a professional social media marketing expert and content planner.
Generate a content calendar consisting of exactly ${count} distinct, high-converting social media posts for the following business niche and target audience:
- Business Niche: ${niche}
- Target Audience: ${targetAudience}
- Target Platform: ${platform}

Return the output strictly in a JSON array format. Do not return any explanation or other text.
IMPORTANT: The JSON array MUST contain exactly ${count} objects using curly braces '{}' for each object (do NOT use square brackets '[]' for objects!).
Example valid format:
[
  {
    "caption": "Post 1 caption text here...",
    "cta": "Click here to buy!",
    "hashtags": ["#tag1", "#tag2", "#tag3"]
  },
  {
    "caption": "Post 2 caption text here...",
    "cta": "Join us today!",
    "hashtags": ["#tag4", "#tag5", "#tag6"]
  }
]

Each object in the JSON array must contain exactly these keys:
- caption: The caption text for the post (written in ${language} language, tailored for local Malaysian audience if Malay, avoiding Indonesian vocabulary. The caption MUST be under 350 characters to ensure the total post length including CTA and hashtags stays strictly under 500 characters).
- cta: A compelling call to action.
- hashtags: An array of 3 relevant hashtags.

Ensure that the posts are diverse (e.g. one educational/value post, one promotional/sales post, one engaging/question post).`;

        // Call the AI provider based on its type
        let responseText = "";

        const providerName = this.provider.constructor?.name || '';
        console.log(`[AutopilotService] Detected provider: ${providerName}`);

        if (providerName === 'CloudflareAIProvider' || typeof this.provider.ai?.run === 'function') {
            // ── Cloudflare AI ──────────────────────────────────────────────────────
            console.log(`[AutopilotService] Calling Cloudflare AI with model: ${this.provider.model}`);
            const res = await this.provider.ai.run(this.provider.model || '@cf/meta/llama-3.2-3b-instruct', {
                messages: [
                    { role: "system", content: "You are a professional social media marketing expert. You must output strictly a JSON array." },
                    { role: "user", content: prompt }
                ]
            });
            if (typeof res === 'string') {
                responseText = res;
            } else if (res.choices && res.choices[0] && res.choices[0].message) {
                responseText = res.choices[0].message.content;
            } else {
                responseText = res.response || JSON.stringify(res);
            }

        } else if (providerName === 'GeminiProvider') {
            // ── Gemini ─────────────────────────────────────────────────────────────
            console.log(`[AutopilotService] Calling Gemini API with model: ${this.provider.model}`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.provider.model}:generateContent?key=${this.provider.apiKey}`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(`Gemini API error: ${res.status} - ${JSON.stringify(err)}`);
            }
            const data = await res.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        } else if (providerName === 'OpenAIProvider') {
            // ── OpenAI ─────────────────────────────────────────────────────────────
            console.log(`[AutopilotService] Calling OpenAI API with model: ${this.provider.model}`);
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.provider.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.provider.model || "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "You are a professional social media marketing expert. You must output strictly a valid JSON array of post objects, each with keys: caption, cta, hashtags. Do not wrap in any object." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.7
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenAI API error: ${res.status} - ${errText}`);
            }
            const data = await res.json();
            responseText = data.choices?.[0]?.message?.content || "";

        } else if (providerName === 'OpenRouterProvider') {
            // ── OpenRouter ─────────────────────────────────────────────────────────
            console.log(`[AutopilotService] Calling OpenRouter API with model: ${this.provider.model}`);
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.provider.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://socialhub.zaimrosli.my",
                    "X-Title": "SocialHub Autopilot"
                },
                body: JSON.stringify({
                    model: this.provider.model || "meta-llama/llama-3.2-3b-instruct:free",
                    messages: [
                        { role: "system", content: "You are a professional social media marketing expert. You must output strictly a JSON array." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.7
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenRouter API error: ${res.status} - ${errText}`);
            }
            const data = await res.json();
            responseText = data.choices?.[0]?.message?.content || "";

        } else {
            // ── Unknown provider — fallback to generic generateCaption-style call ──
            console.warn(`[AutopilotService] Unknown provider type "${providerName}", attempting generic call.`);
            throw new Error(`Unsupported AI provider type: ${providerName}. Please configure a valid API key in Settings.`);
        }

        if (!responseText) {
            throw new Error("AI provider returned an empty response.");
        }

        // Clean up markdown block wrapper if present
        const cleaned = responseText.replace(/```json/i, '').replace(/```/g, '').trim();

        // Handle OpenAI JSON object wrapper (response_format: json_object may wrap array)
        let parsedRaw;
        try {
            parsedRaw = JSON.parse(cleaned);
        } catch (e) {
            console.error("[AutopilotService] JSON Parse failed for raw response:", responseText);
            throw new Error("Failed to parse AI response as a valid JSON array.");
        }

        // If AI returned { posts: [...] } or { campaigns: [...] } wrapper, unwrap it
        let campaignPosts;
        if (Array.isArray(parsedRaw)) {
            campaignPosts = parsedRaw;
        } else if (typeof parsedRaw === 'object' && parsedRaw !== null) {
            // Try to find an array property
            const arrayProp = Object.values(parsedRaw).find(v => Array.isArray(v));
            if (arrayProp) {
                campaignPosts = arrayProp;
            } else {
                throw new Error("AI response did not return a JSON array.");
            }
        } else {
            throw new Error("AI response did not return a JSON array.");
        }

        // Slice to requested count just in case
        campaignPosts = campaignPosts.slice(0, count);

        // Optimal hours: 9 AM, 12 PM, 6 PM
        const optimalHours = [9, 12, 18];
        const offset = typeof timezoneOffset === 'number' ? timezoneOffset : -480; // default UTC+8
        const postsPerDay = parseInt(frequency) || 1;

        const scheduledCampaign = campaignPosts.map((post, idx) => {
            const daysAhead = Math.floor(idx / postsPerDay) + 1; // Starts tomorrow
            const timeIndex = idx % postsPerDay;
            
            let localHour = 9;
            if (postsPerDay === 1) {
                const singleOptimalHours = [9, 12, 18, 15, 10];
                localHour = singleOptimalHours[idx % singleOptimalHours.length];
            } else {
                localHour = optimalHours[timeIndex % optimalHours.length];
            }
            
            // Calculate UTC timestamp
            const date = new Date();
            date.setUTCDate(date.getUTCDate() + daysAhead);
            const utcHour = localHour + (offset / 60);
            date.setUTCHours(utcHour, 0, 0, 0);

            // Normalize field names — different AI providers may use different keys
            const caption = post.caption || post.text || post.content || post.body || post.post || '';
            const cta = post.cta || post.call_to_action || post.callToAction || post.action || '';
            const rawHashtags = post.hashtags || post.tags || post.hash_tags || [];
            const hashtagsText = Array.isArray(rawHashtags) ? rawHashtags.join(' ') : (typeof rawHashtags === 'string' ? rawHashtags : '');

            // Build full content — skip empty sections gracefully
            const parts = [caption, cta, hashtagsText].filter(p => p && p.trim() !== '');
            const fullContent = parts.join('\n\n').trim();

            return {
                content: fullContent || `Post ${idx + 1}`,
                publish_at: date.toISOString()
            };
        });

        return scheduledCampaign;
    }
}
