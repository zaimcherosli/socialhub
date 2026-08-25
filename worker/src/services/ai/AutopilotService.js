export class AutopilotService {
    constructor(provider) {
        this.provider = provider;
    }

    async generateAutopilotCampaign({ niche, targetAudience, platform, count, language, timezoneOffset, frequency, ctaLink, postFormat, nicheRules, nicheKey, nicheName, exampleOutput }) {
        console.log(`[AutopilotService] Starting autopilot campaign generation for niche: "${niche}", count: ${count}, frequency: ${frequency}, format: ${postFormat}, ctaLink: ${ctaLink}, nicheKey: ${nicheKey}`);

        let formatInstructions = "";
        if (postFormat === 'short_thread') {
            formatInstructions = `
- Each post in the calendar MUST be a Thread Storm (berangkai) consisting of exactly 2 to 3 thread posts/slides.
- Split the slides of each thread storm using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content'.
- Each individual slide/card in the thread storm must be under 300 characters.`;
        } else if (postFormat === 'deep_thread') {
            formatInstructions = `
- Each post in the calendar MUST be a deep-dive Thread Storm (berangkai) consisting of exactly 3 to 5 thread posts/slides.
- Split the slides of each thread storm using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content\\n---thread-separator---\\nSlide 4 content'.
- Each individual slide/card in the thread storm must be under 300 characters.`;
        } else {
            formatInstructions = `
- Each post in the calendar must be a single post.
- The caption text must be under 350 characters.`;
        }

        let ctaInstructions = "A casual, non-pushy redirect phrase.";
        if (ctaLink && ctaLink.trim() !== '') {
            const cleanCta = ctaLink.trim();
            const isUrl = cleanCta.startsWith('http://') || cleanCta.startsWith('https://') || cleanCta.includes('wa.me/');
            if (isUrl) {
                ctaInstructions = `A very casual, laid-back, and non-pushy Malaysian conversational redirect phrase pointing to the link: ${cleanCta}. Example: 'Nah link kalau ada yang nak ushar: ${cleanCta}', 'Korang ushar sendiri kat sini: ${cleanCta}', or 'Kot lah ada yang nak tengok: ${cleanCta}'. Do NOT write salesy or pushy calls-to-action like 'Dapatkan sekarang!' or 'Beli hari ini!'.`;
            } else {
                ctaInstructions = `The user specified a direct CTA instruction: "${cleanCta}". Generate a very natural, conversational Malaysian CTA line using this instruction. For example, if "${cleanCta}" is "DM" or "DM kami", write "Berminat? Boleh DM terus untuk semakan / maklumat lanjut." or "Korang yang berminat, roger melalui DM sekarang!" or "Drop DM kalau nak tahu details.". Do NOT mention any website links, URLs, or phrases like "Nah link..." or "Kat link ni:".`;
            }
        } else {
            ctaInstructions = `A casual, friendly, non-pushy Malaysian engagement or action question (e.g. 'Korang rasa macam mana? Komen kat bawah.', 'Berminat? Boleh DM kami terus untuk info lanjut.'). CRITICAL STRICT MANDATE: You are STRICTLY FORBIDDEN from using the word 'link', 'link ni', 'pautan', 'url', or mentioning any website links because NO URL link is provided by the user. Do NOT write fake link phrases like 'ushar link ni' or 'tengok link kat sini'!`;
        }

        let langStyle = `written in ${language} language, tailored for local Malaysian audience if Malay, avoiding Indonesian vocabulary.`;
        if (language && language.toLowerCase().includes('manglish')) {
            langStyle = `written in natural Malaysian Manglish (a casual, trendy mix of Bahasa Melayu and English commonly used by modern Malaysians on Threads & social media, e.g. 'Seriously weh, I tak expect pun benda ni best giler', 'I thought benda ni biasa je, tapi bila try solid gak').`;
        }

        // Determine niche-specific curiosity phrasing guidelines
        let curiosityGuide = "NEVER mention the exact product name, brand name, model name, or specific residential project name directly in the caption text. Instead, refer to it using generic, curiosity-inducing terms (e.g. 'benda ni', 'gadget ni', 'kipas ni', 'apartment ni', 'unit ni', 'benda viral ni') to create mystery and engagement.";
        
        const isFinanceNiche = nicheKey === 'pembiayaan' || /\b(pembiayaan|pinjaman|personal\s*loan|loan|koperasi|overlap|penyatuan\s*hutang|debt\s*consolidation|ccris|ctos|dsr|kewangan|advisor|nama\s*tak\s*cantik|nama\s*sangkut|blacklist|slip\s*gaji|bank)\b/i.test(niche);
        const isPropertyNiche = nicheKey === 'hartanah' || /\b(rumah|apartment|condo|kondo|hartanah|teres|sewa|jual|property)\b/i.test(niche);

        if (isFinanceNiche) {
            curiosityGuide = "STRICT FINANCIAL ADVISORY & LOAN CONSULTANCY RULES: This is a professional loan consultancy service helping Malaysians with personal financing, bank loans, debt consolidation, and CCRIS/CTOS issues. You are STRICTLY FORBIDDEN from using e-commerce words like 'benda ni', 'gadget ni', or 'barang ni'. Explain clearly that 'nama tak cantik' means having high commitments / CCRIS / CTOS records and provide real hope by offering loan eligibility checking or debt consolidation consultation ('skim pembiayaan khas', 'pelan penyatuan hutang', 'fasiliti koperasi', 'servis semak kelayakan percuma').";
        } else if (isPropertyNiche) {
            curiosityGuide = "STRICT REAL ESTATE TERMINOLOGY: Refer to listings using real estate terms like 'unit ni', 'apartment ni', 'rumah teres ni', 'kawasan ni'. Do not reveal the exact project name or developer name early on.";
        }

        let nicheRulesPromptBlock = "";
        if (nicheRules && Array.isArray(nicheRules) && nicheRules.length > 0) {
            nicheRulesPromptBlock = `\nCRITICAL SPECIALIZED NICHE RULES (${nicheName || nicheKey || 'Specialized Niche'}):\nYou MUST strictly adhere to these niche rules to sound authentic and industry-accurate:\n${nicheRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`;
        }

        let exampleGuide = "";
        if (exampleOutput && exampleOutput.trim()) {
            exampleGuide = `\nREFERENCE STYLE & STRUCTURE EXAMPLE (Use this style & tone as inspiration, but create original posts for the topic):\n---\n${exampleOutput.trim()}\n---\n`;
        }

        // Custom prompt requesting a JSON array of posts
        const prompt = `You are a professional social media marketing expert and content planner.
Generate a content calendar consisting of exactly ${count} distinct, high-converting social media posts for the following business niche and target audience:
- Business Niche: ${niche}
- Target Audience: ${targetAudience}
- Target Platform: ${platform}
${nicheRulesPromptBlock}${exampleGuide}
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
- caption: The caption text for the post (${langStyle} ${formatInstructions}).
- cta: ${ctaInstructions}
- hashtags: An array of 3 relevant hashtags.

CRITICAL HOOK & CONTENT DIVERSITY RULES (VERY IMPORTANT TO AVOID REPETITION):
1. Vary the opening hook (first sentence) of every post. Do NOT reuse the same structure or opening style across different posts.
2. NO REPETITIVE STARTING WORDS: NO TWO posts in the list may start with the same word (e.g., do NOT start multiple posts with "Benda...", "Bila...", "Aku...", "Dulu..."). Each post must start with a completely unique word and grammatical structure.
3. STICK TO STRICT HOOK LIMITATIONS: A maximum of ONE post in the list may start with a question hook like "Pernah tak...?" or "Korang tahu tak...?".
4. For all other posts, use a wide variety of different hook styles such as:
   - Direct relatable statements (e.g., "Rasa meluat pulak bila...", "Ramai yang tersilap langkah bila...", "Rupa-rupanya ramai tak tahu...")
   - Direct observations/opinions (e.g., "Tengah layan phone tiba-tiba...", "Dulu aku pun jenis yang...", "Baru-baru ni aku perasan...")
   - Straightforward sharing/tips (e.g., "Ini cara paling mudah untuk...", "Sebenarnya tak susah pun nak...", "Khas untuk yang nak...")
   - Experiential stories (e.g., "Minggu lepas aku cuba...", "Lama juga aku cari solution untuk...")
5. Make each post sound completely fresh, unique, and written at different times by a real person. Do NOT let them look templated or AI-generated.
6. CURIOSITY & MYSTERY RULE: ${curiosityGuide}
7. PLATFORM-NEUTRAL RULE: Do NOT hardcode specific platform names like 'kat Threads', 'kat IG', or 'kat FB' inside the caption text, so that posts are suitable for cross-posting across Threads, Instagram, and Facebook naturally.
8. ABSOLUTELY NO FAKE LINK PHRASES: If no URL link was provided, do NOT write phrases like 'ushar link ni', 'tengok link ni', or 'kat link ni'. Use direct engagement or DM calls to action instead.`;

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
            let fullContent = parts.join('\n\n').trim();

            if (!/https?:\/\//i.test(fullContent)) {
                // Sanitize any stray fake link phrases when no HTTP/HTTPS URL exists
                fullContent = fullContent
                    .replace(/ushar (?:dulu )?link ni/gi, 'DM kami terus')
                    .replace(/kat link ni/gi, 'secara DM')
                    .replace(/tengok link ni/gi, 'DM kami')
                    .replace(/klik link ni/gi, 'DM kami')
                    .replace(/pautan ni/gi, 'DM kami');
            }
            // Clean up hardcoded "posting Threads" for cross-platform neutrality
            fullContent = fullContent.replace(/ posting Threads /gi, ' posting ');

            return {
                content: fullContent || `Post ${idx + 1}`,
                publish_at: date.toISOString()
            };
        });

        return scheduledCampaign;
    }
}
