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

        // Call the AI provider
        let responseText = "";
        if (typeof this.provider.ai?.run === 'function') {
            // Cloudflare AI Provider
            console.log(`[AutopilotService] Calling Cloudflare AI with model: ${this.provider.model}`);
            const res = await this.provider.ai.run(this.provider.model, {
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
        } else {
            // Gemini Provider
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
        }

        if (!responseText) {
            throw new Error("AI provider returned an empty response.");
        }

        // Clean up markdown block wrapper if present
        const cleaned = responseText.replace(/```json/i, '').replace(/```/g, '').trim();
        let campaignPosts;
        try {
            campaignPosts = JSON.parse(cleaned);
        } catch (e) {
            console.error("[AutopilotService] JSON Parse failed for raw response:", responseText);
            throw new Error("Failed to parse AI response as a valid JSON array.");
        }

        if (!Array.isArray(campaignPosts)) {
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

            // Merge caption, cta and hashtags
            const hashtagsText = Array.isArray(post.hashtags) ? post.hashtags.join(' ') : '';
            const fullContent = `${post.caption}\n\n${post.cta}\n\n${hashtagsText}`.trim();

            return {
                content: fullContent,
                publish_at: date.toISOString()
            };
        });

        return scheduledCampaign;
    }
}
