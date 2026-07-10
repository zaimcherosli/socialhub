/**
 * SocialHub AI Provider Base Interface
 * Defines the strict contract all AI providers must implement.
 */
export class AIProvider {
    /**
     * Generate captions based on input parameters.
     * @param {object} promptOptions { businessType, product, targetAudience, goal, tone, language, postFormat, funnelStage }
     * @returns {Promise<object>} JSON structure { caption, cta, hashtags }
     */
    async generateCaption(promptOptions) {
        throw new Error("generateCaption must be implemented by subclasses");
    }

    /**
     * Generate thread storm copywriting from URL details.
     * @param {object} options { title, description, url, tone, language }
     * @returns {Promise<object>} JSON structure { title, threads: string[], cta, hashtags }
     */
    async generateThreadStorm(options) {
        throw new Error("generateThreadStorm must be implemented by subclasses");
    }

    /**
     * Generate chat responses based on chat history.
     * @param {object[]} messages Array of messages { role, content }
     * @returns {Promise<string>} Plain text response
     */
    async generateChatResponse(messages) {
        throw new Error("generateChatResponse must be implemented by subclasses");
    }

    /**
     * Assemble caption system prompt in a provider-agnostic way.
     */
    assembleCaptionPrompt({
        businessType,
        product,
        targetAudience,
        goal,
        tone,
        language,
        customInstructions,
        postFormat,
        funnelStage,
        nicheRules,
        nicheExampleOutput
    }) {
        let prompt = "";

        // Format formatting instructions & JSON structure
        let formatInstructions = "";
        if (postFormat === 'deep_thread') {
            formatInstructions = `- Format: Thread / Bebenang Berangkai (DEEP). You MUST generate a sequence of exactly 4 to 5 connected slides/posts. The "caption" key in the JSON output MUST be a JSON array of strings containing these 4 to 5 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else if (postFormat === 'short_thread') {
            formatInstructions = `- Format: Thread / Bebenang Ringkas (SHORT). You MUST generate a sequence of exactly 2 to 3 connected slides/posts (no more than 3). The "caption" key in the JSON output MUST be a JSON array of strings containing these 2 to 3 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else {
            formatInstructions = `- Format: Single standalone post. The caption must be under 350 characters.`;
        }

        let jsonStructure = "";
        if (postFormat === 'deep_thread') {
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
        } else if (postFormat === 'short_thread') {
            jsonStructure = `{
  "caption": [
    "Slide 1 content under 300 characters",
    "Slide 2 content under 300 characters",
    "Slide 3 content under 300 characters"
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

        // Custom example output prompt format
        if (nicheExampleOutput && nicheExampleOutput.trim() !== '') {
            let rulesBlock = "";
            if (nicheRules && Array.isArray(nicheRules) && nicheRules.length > 0) {
                rulesBlock = `CRITICAL NICHE RULES (You MUST follow these rules closely):\n${nicheRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
            } else if (customInstructions) {
                rulesBlock = customInstructions;
            }

            prompt = `${rulesBlock}

Berikut adalah CONTOH thread yang mengikut gaya & struktur yang betul untuk niche ini:
---
${nicheExampleOutput.trim()}
---

Generate thread BARU mengikut gaya penulisan, tone, dan struktur umum dari contoh di atas, tetapi menggunakan maklumat produk/hartanah di bawah.
PENTING:
1. Jangan tiru atau salin bulat-bulat ayat pembuka (hook) dari contoh di atas. Pelbagaikan gaya pembuka untuk setiap post baru (contohnya: mulakan dengan soalan menarik, highlight harga/tawaran terus, atau sebut masalah utama pembeli). Pastikan ia unik dan natural.
2. Sekiranya maklumat di bawah adalah topik perbincangan, perkongsian tips, atau perbandingan umum (BUKAN iklan/listing spesifik bagi unit tertentu), JANGAN reka atau reka-reka (hallucinate) butiran unit (seperti saiz sqft, bilangan bilik, status freehold/leasehold, fasiliti, atau meminta viewing). Sebaliknya, fokus sepenuhnya untuk membincangkan topik/tips tersebut menggunakan gaya bahasa dan tone dari contoh.
3. PERATURAN MISTERI & CTR (CURIOSITY RULE): JANGAN sebut nama spesifik produk, nama jenama, model produk (seperti 'Machenike G3 V2', 'Residensi Adelia', 'Bangi Avenue') di dalam teks copywriting. Sebaliknya, gunakan nama am atau kata ganti misteri (seperti 'benda ni', 'gadget ni', 'kipas ni', 'apartment ni', 'unit ni', 'benda viral ni') untuk membina rasa ingin tahu (curiosity) pembaca supaya mereka terpaksa klik pautan (link) untuk mengetahui nama/jenama produk tersebut.

${product}
`;
            
            prompt += `\n\nAdditional Requirements:\n- Tone: ${tone || 'Friendly & Casual'}\n- Language: ${language || 'Malay'}\n- ${formatInstructions}\n- PENTING: Jangan masukkan nama ejen, nombor REN/PEA/REA, nombor telefon, atau sebarang link wasap/wa.me dari maklumat produk dalam output. CTA dan maklumat hubungi akan diisi oleh sistem secara berasingan. Jangan sebut nama spesifik produk atau nama perumahan untuk membina unsur misteri.\n\nProvide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:\n${jsonStructure}`;

        } else {
            // Normal prompt assembly logic
            prompt = `You are a social media copywriter.
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

            prompt += `- ${formatInstructions}\n\n`;

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
6. HOOK DIVERSITY: Vary your opening sentence structure. NO REPETITIVE STARTING WORDS: Ensure different posts start with unique words (do NOT start multiple posts with "Benda...", "Bila...", "Aku..."). Use a wide variety of starting phrasings (e.g., "Ramai tak perasan...", "Rupa-rupanya...", "Aku baru try...", "Lama jugak aku cari...", "Paling geram bila...").
7. CURIOSITY & MYSTERY RULE (No Product/Brand/Project Names): NEVER mention the exact product name, brand name, model name (e.g. 'Machenike G3 V2', 'Residensi Adelia', 'Bangi Avenue') directly in the copywriting text. Instead, refer to it using generic, curiosity-inducing terms (e.g., 'benda ni', 'gadget ni', 'kipas ni', 'apartment ni', 'unit ni', 'benda viral ni') to create mystery and drive clicks to the destination link.
`;
            } else {
                prompt += `GUIDELINES:
1. Write in a natural, human tone matching the specified tone of voice.
2. The CTA should be highly engaging and relevant to the post's goal.
`;
            }

            prompt += `\nIMPORTANT: Do NOT include any real estate agent name, REN/PEA/REA registration number, phone number, or WhatsApp/wasap link from the product context in your output. The CTA and contact info will be appended separately by the system.\n`;

            prompt += `\nProvide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:\n${jsonStructure}`;
        }

        return prompt;
    }
}

