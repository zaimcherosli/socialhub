export class AutopilotService {
    constructor(provider) {
        this.provider = provider;
    }

    async generateAutopilotCampaign({ niche, targetAudience, platform, count, language, timezoneOffset, frequency, ctaLink, postFormat, nicheRules, nicheKey, nicheName, exampleOutput }) {
        console.log(`[AutopilotService] Starting autopilot campaign generation for niche: "${niche}", count: ${count}, frequency: ${frequency}, format: ${postFormat}, ctaLink: ${ctaLink}, nicheKey: ${nicheKey}`);

        let formatInstructions = "";
        const lineSpacingRule = `\n- MANDATORY LINE SPACING: Inside each individual slide/card, write in short micro-paragraphs (strictly 1 to 2 sentences each) and separate every micro-paragraph with an empty line (double newline \\n\\n). Never merge multiple points into one continuous thick paragraph.`;

        if (postFormat === 'mega_thread') {
            formatInstructions = `
- Each post in the calendar MUST be an epic Mega Thread Storm (bebenang panjang / berangkai mendalam) consisting of strictly 7 to 10 thread posts/slides.
- Split the slides of each thread storm using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content\\n---thread-separator---\\nSlide 4 content\\n---thread-separator---\\nSlide 5 content\\n---thread-separator---\\nSlide 6 content\\n---thread-separator---\\nSlide 7 content\\n---thread-separator---\\nSlide 8 content'.
- Each individual slide/card in the thread storm must be around 280 to 420 characters (providing 3 to 4 substantial lines/sentences of engaging, insightful storytelling progression while staying safely under the 500-character Threads limit).
- STRUCTURE OF EACH MEGA THREAD (7 to 10 SLIDES):
  * Slide 1: High-impact intrigue/problem hook that immediately stops readers from scrolling.
  * Slides 2 to 6: In-depth breakdown, step-by-step points, real comparisons, hidden pitfalls, or insider secrets.
  * Slides 7 to 8 (or 9-10): Climax, summary takeaways, and natural progression leading to the conclusion.
- CRITICAL: You MUST include the exact delimiter '---thread-separator---' between every single slide! Do not combine slides into one.${lineSpacingRule}`;
        } else if (postFormat === 'deep_thread') {
            formatInstructions = `
- Each post in the calendar MUST be a deep-dive Thread Storm (berangkai) consisting of exactly 3 to 5 thread posts/slides.
- Split the slides of each thread storm using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content\\n---thread-separator---\\nSlide 4 content'.
- Each individual slide/card in the thread storm must be around 350 to 450 characters (providing 3 to 4 substantial lines/sentences of rich explanation while staying safely under the 500-character Threads limit).
- CRITICAL: You MUST include the exact delimiter '---thread-separator---' between every single slide! Do not combine slides into one.${lineSpacingRule}`;
        } else if (postFormat === 'short_thread') {
            formatInstructions = `
- Each post in the calendar MUST be a Thread Storm (berangkai) consisting of exactly 2 to 3 thread posts/slides.
- Split the slides of each thread storm using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content'.
- Each individual slide/card in the thread storm must be around 350 to 450 characters (providing 3 to 4 substantial lines/sentences of rich explanation while staying safely under the 500-character Threads limit).
- CRITICAL: You MUST include the exact delimiter '---thread-separator---' between every single slide! Do not combine slides into one.${lineSpacingRule}`;
        } else {
            formatInstructions = `
- Each post in the calendar must be a single post.
- The caption text must be around 400 to 600 characters with rich, high-converting storytelling paragraphs.${lineSpacingRule}`;
        }

        // Normalize CTA Link (auto-convert raw phone numbers to WhatsApp wa.me links)
        let normalizedCtaLink = (ctaLink || '').trim();
        if (/^\+?\d{8,15}$/.test(normalizedCtaLink.replace(/\s+/g, ''))) {
            let cleanDigits = normalizedCtaLink.replace(/\D/g, '');
            if (cleanDigits.startsWith('01')) cleanDigits = '6' + cleanDigits;
            normalizedCtaLink = `https://wa.me/${cleanDigits}`;
        }

        let ctaInstructions = "A casual, non-pushy redirect phrase.";
        if (normalizedCtaLink !== '') {
            const isUrl = normalizedCtaLink.startsWith('http://') || normalizedCtaLink.startsWith('https://') || normalizedCtaLink.includes('wa.me/');
            if (isUrl) {
                const isWa = normalizedCtaLink.includes('wa.me') || normalizedCtaLink.includes('whatsapp');
                if (isWa) {
                    ctaInstructions = `A natural, friendly, non-pushy Malaysian WhatsApp CTA inviting readers to contact/consult/semak kelayakan with the exact WhatsApp link: ${normalizedCtaLink}. Example: 'Berminat nak semak kelayakan secara percuma? WhatsApp kami slip gaji terus kat sini: ${normalizedCtaLink}', 'Untuk kiraan DSR & semak slip gaji, roger kami di WhatsApp: ${normalizedCtaLink}', or 'Ada sebarang soalan atau nak semak dokumen? Tekan link WhatsApp kami: ${normalizedCtaLink}'. MANDATORY: You MUST include the exact link ${normalizedCtaLink} in the cta output!`;
                } else {
                    ctaInstructions = `A very casual, laid-back, and non-pushy Malaysian conversational redirect phrase pointing to the link: ${normalizedCtaLink}. Example: 'Nah link kalau ada yang nak ushar: ${normalizedCtaLink}', 'Korang ushar sendiri kat sini: ${normalizedCtaLink}', or 'Kot lah ada yang nak tengok: ${normalizedCtaLink}'. Do NOT write salesy or pushy calls-to-action like 'Dapatkan sekarang!' or 'Beli hari ini!'.`;
                }
            } else {
                ctaInstructions = `The user specified a direct CTA instruction: "${normalizedCtaLink}". Generate a very natural, conversational Malaysian CTA line using this instruction. For example, if "${normalizedCtaLink}" is "DM" or "DM kami", write "Berminat? Boleh DM terus untuk semakan / maklumat lanjut." or "Korang yang berminat, roger melalui DM sekarang!" or "Drop DM kalau nak tahu details.". Do NOT mention any website links, URLs, or phrases like "Nah link..." or "Kat link ni:".`;
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

        // Chunking / batching to prevent LLM token cap truncation (especially for mega threads with 7-10 slides each)
        const isMegaThread = postFormat === 'mega_thread';
        const isDeepThread = postFormat === 'deep_thread';
        const isShortThread = postFormat === 'short_thread';
        const isThreadFormat = isMegaThread || isDeepThread || isShortThread;

        let batchSize = 5;
        if (isMegaThread) {
            batchSize = 3; // 3 mega threads (7-10 slides each = ~24 slides) per LLM call
        } else if (isDeepThread) {
            batchSize = 3; // 3-5 slides each = ~12 slides per call
        } else if (isShortThread) {
            batchSize = 4;
        } else {
            batchSize = 5;
        }

        const totalCount = parseInt(count, 10) || 3;
        const batches = [];
        let remaining = totalCount;
        while (remaining > 0) {
            const currentBatchSize = Math.min(remaining, batchSize);
            batches.push(currentBatchSize);
            remaining -= currentBatchSize;
        }

        console.log(`[AutopilotService] Generating ${totalCount} posts in ${batches.length} batch(es): [${batches.join(', ')}] for format "${postFormat}"`);

        const batchAngleNotes = [
            "Focus on common misconceptions, shocking comparisons, and beginner mistakes.",
            "Focus on hidden secrets, insider industry facts, and what most people overlook.",
            "Focus on practical decision frameworks, step-by-step guides, and real-world evaluation criteria.",
            "Focus on long-term value, maintenance/cost pitfalls, and smart consumer strategies.",
            "Focus on actionable checklists, FAQs, and inspiring transformation advice."
        ];

        const buildPromptForBatch = (batchCount, batchIdx) => {
            const batchAngle = batches.length > 1 ? `\n- Thematic Focus for these ${batchCount} posts: ${batchAngleNotes[batchIdx % batchAngleNotes.length]}` : '';
            return `You are a professional social media marketing expert and content planner.
Generate a content calendar consisting of exactly ${batchCount} distinct, high-converting social media posts for the following business niche and target audience:
- Business Niche: ${niche}
- Target Audience: ${targetAudience}
- Target Platform: ${platform}${batchAngle}
${nicheRulesPromptBlock}${exampleGuide}
Return the output strictly in a JSON array format. Do not return any explanation or other text.
IMPORTANT: The JSON array MUST contain exactly ${batchCount} objects using curly braces '{}' for each object (do NOT use square brackets '[]' for objects!).
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
        };

        const maxTokens = (isMegaThread || isDeepThread) ? 8192 : 4096;

        let allPosts = [];
        if (batches.length === 1) {
            const prompt = buildPromptForBatch(batches[0], 0);
            allPosts = await this._callAI(prompt, maxTokens);
        } else {
            // Concurrency limit of 2 to balance speed and provider rate limits
            const results = new Array(batches.length);
            let nextIndex = 0;
            const workerCount = Math.min(2, batches.length);
            const workers = Array.from({ length: workerCount }, async () => {
                while (nextIndex < batches.length) {
                    const currentIdx = nextIndex++;
                    const prompt = buildPromptForBatch(batches[currentIdx], currentIdx);
                    try {
                        results[currentIdx] = await this._callAI(prompt, maxTokens);
                    } catch (err) {
                        console.error(`[AutopilotService] Batch ${currentIdx + 1} failed:`, err);
                        throw err;
                    }
                }
            });
            await Promise.all(workers);
            allPosts = results.flat().filter(Boolean);
        }

        let campaignPosts = allPosts.slice(0, totalCount);

        // Standard Malaysian slots (9 AM, 12 PM, 3 PM, 6 PM, 9 PM)
        const offset = typeof timezoneOffset === 'number' ? timezoneOffset : -480; // default UTC+8
        const postsPerDay = parseInt(frequency, 10) || 1;

        let dailySlots = [9];
        if (postsPerDay === 1) {
            dailySlots = [9];
        } else if (postsPerDay === 2) {
            dailySlots = [9, 15]; // 9 AM, 3 PM
        } else if (postsPerDay === 3) {
            dailySlots = [9, 12, 15]; // 9 AM, 12 PM, 3 PM (consecutive)
        } else if (postsPerDay === 5) {
            dailySlots = [9, 12, 15, 18, 21]; // Full 5 standard slots
        } else {
            const standard = [9, 12, 15, 18, 21];
            dailySlots = standard.slice(0, Math.min(postsPerDay, standard.length));
        }

        const scheduledCampaign = campaignPosts.map((post, idx) => {
            const daysAhead = Math.floor(idx / postsPerDay) + 1; // Starts tomorrow
            const timeIndex = idx % postsPerDay;
            const localHour = dailySlots[timeIndex % dailySlots.length];
            
            // Calculate UTC timestamp
            const date = new Date();
            date.setUTCDate(date.getUTCDate() + daysAhead);
            const utcHour = localHour + (offset / 60);
            date.setUTCHours(utcHour, 0, 0, 0);

            // Normalize field names — different AI providers may return different keys or types
            let rawCaption = post.caption || post.text || post.content || post.body || post.post || '';
            let caption = '';
            if (Array.isArray(rawCaption)) {
                caption = rawCaption.map(s => String(s || '').trim()).filter(Boolean).join('\n\n---thread-separator---\n\n');
            } else if (typeof rawCaption === 'string') {
                caption = rawCaption.trim();
            } else if (rawCaption) {
                caption = String(rawCaption).trim();
            }

            // If caption is empty but post.slides or post.cards exists
            if (!caption && (Array.isArray(post.slides) || Array.isArray(post.cards))) {
                const slidesArr = post.slides || post.cards;
                caption = slidesArr.map(s => String(s || '').trim()).filter(Boolean).join('\n\n---thread-separator---\n\n');
            }

            // Fallback for thread formats: if AI outputted slides with labels (e.g. Slide 1:) instead of ---thread-separator---
            if (isThreadFormat && !caption.includes('---thread-separator---')) {
                const slideSplitRegex = /(?:\r?\n)+(?=(?:Slide|Slaid|Card|Bahagian|Part|Post)\s*\d+[:.)\s])/i;
                if (slideSplitRegex.test(caption)) {
                    const parts = caption.split(slideSplitRegex).map(s => s.trim()).filter(Boolean);
                    if (parts.length > 1) {
                        caption = parts.join('\n\n---thread-separator---\n\n');
                    }
                }
            }

            let cta = (post.cta || post.call_to_action || post.callToAction || post.action || '').trim();
            const rawHashtags = post.hashtags || post.tags || post.hash_tags || [];
            const hashtagsText = Array.isArray(rawHashtags) ? rawHashtags.join(' ').trim() : (typeof rawHashtags === 'string' ? rawHashtags.trim() : '');

            // Deduplicate CTA: If the LLM already included the CTA inside the caption text, do not append it again
            if (cta) {
                const normCaption = caption.toLowerCase().replace(/[^a-z0-9]/g, '');
                const normCta = cta.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normCta && (normCaption.includes(normCta) || normCaption.endsWith(normCta) || (normCta.length > 10 && normCaption.includes(normCta.slice(0, 15))))) {
                    cta = '';
                }
            }

            // GUARANTEED LINK INJECTION: If a valid URL/WhatsApp link was configured, ensure the link is present in the final copy!
            if (normalizedCtaLink !== '') {
                const isUrl = normalizedCtaLink.startsWith('http://') || normalizedCtaLink.startsWith('https://') || normalizedCtaLink.includes('wa.me/');
                if (isUrl) {
                    const fullTextSoFar = `${caption} ${cta}`;
                    if (!fullTextSoFar.includes(normalizedCtaLink)) {
                        const isWa = normalizedCtaLink.includes('wa.me') || normalizedCtaLink.includes('whatsapp');
                        if (isWa) {
                            if (cta && /whatsapp/i.test(cta)) {
                                cta = `${cta} 👉 ${normalizedCtaLink}`;
                            } else if (cta) {
                                cta = `${cta}\n\n👉 WhatsApp kami: ${normalizedCtaLink}`;
                            } else {
                                cta = `Berminat untuk maklumat lanjut / semak kelayakan? WhatsApp kami di: ${normalizedCtaLink}`;
                            }
                        } else {
                            if (cta) {
                                cta = `${cta} 👉 ${normalizedCtaLink}`;
                            } else {
                                cta = `Info lanjut kat sini: ${normalizedCtaLink}`;
                            }
                        }
                    }
                }
            }

            // Build full content
            let fullContent = '';
            if (isThreadFormat && caption.includes('---thread-separator---')) {
                // Thread format: append CTA and hashtags cleanly to the final slide, or create a closing slide if needed
                const existingSlides = caption.split('---thread-separator---').map(s => s.trim()).filter(Boolean);
                const lastSlide = existingSlides[existingSlides.length - 1] || '';
                const closingAdditions = [cta, hashtagsText].filter(Boolean).join('\n\n');
                if (closingAdditions) {
                    if (lastSlide.length + closingAdditions.length > 450) {
                        // Append as an additional dedicated conclusion slide
                        fullContent = `${caption}\n\n---thread-separator---\n\n${closingAdditions}`;
                    } else {
                        fullContent = `${caption}\n\n${closingAdditions}`;
                    }
                } else {
                    fullContent = caption;
                }
            } else {
                const parts = [caption, cta, hashtagsText].filter(p => p && p.trim() !== '');
                fullContent = parts.join('\n\n').trim();
            }

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

    async _callAI(prompt, maxTokens = 8192) {
        let responseText = "";
        const providerName = this.provider.constructor?.name || '';
        console.log(`[AutopilotService] Calling AI provider: ${providerName}, model: ${this.provider.model}`);

        if (providerName === 'CloudflareAIProvider' || typeof this.provider.ai?.run === 'function') {
            const res = await this.provider.ai.run(this.provider.model || '@cf/meta/llama-3.2-3b-instruct', {
                messages: [
                    { role: "system", content: "You are a professional social media marketing expert. You must output strictly a JSON array." },
                    { role: "user", content: prompt }
                ],
                max_tokens: Math.min(maxTokens, 4096)
            });
            if (typeof res === 'string') {
                responseText = res;
            } else if (res.choices && res.choices[0] && res.choices[0].message) {
                responseText = res.choices[0].message.content;
            } else {
                responseText = res.response || JSON.stringify(res);
            }
        } else if (providerName === 'GeminiProvider') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.provider.model}:generateContent?key=${this.provider.apiKey}`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        maxOutputTokens: maxTokens
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
            const data = await this.provider._fetchChatCompletions({
                model: this.provider.model || "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a professional social media marketing expert. You must output strictly a valid JSON array of post objects, each with keys: caption, cta, hashtags. Do not wrap in any object." },
                    { role: "user", content: prompt }
                ],
                max_tokens: maxTokens,
                ...(this.provider.isReasoningModel && this.provider.isReasoningModel() ? {} : { temperature: 0.7 })
            });
            responseText = data.choices?.[0]?.message?.content || "";
        } else if (providerName === 'OpenRouterProvider') {
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
                    max_tokens: maxTokens,
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
            throw new Error(`Unsupported AI provider type: ${providerName}. Please configure a valid API key in Settings.`);
        }

        if (!responseText) {
            throw new Error("AI provider returned an empty response.");
        }

        return this._parseJsonArray(responseText);
    }

    _parseJsonArray(responseText) {
        const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

        // 1. Direct parse attempt
        try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) return parsed;
            if (typeof parsed === 'object' && parsed !== null) {
                const arrayProp = Object.values(parsed).find(v => Array.isArray(v));
                if (arrayProp) return arrayProp;
            }
        } catch (_) {}

        // 2. Extract outermost [ ... ]
        const startIdx = cleaned.indexOf('[');
        const endIdx = cleaned.lastIndexOf(']');
        if (startIdx !== -1 && endIdx > startIdx) {
            try {
                const slice = cleaned.slice(startIdx, endIdx + 1);
                const parsed = JSON.parse(slice);
                if (Array.isArray(parsed)) return parsed;
            } catch (_) {}
        }

        console.error("[AutopilotService] JSON Parse failed for raw response:", responseText);
        throw new Error("Failed to parse AI response as a valid JSON array.");
    }
}
