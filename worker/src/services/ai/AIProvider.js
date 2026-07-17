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
        nicheExampleOutput,
        nicheKey,
        isPreset
    }) {
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

        if (isPreset) {
            const prompt = `You are a social media content creator.
Write a highly engaging, warm and natural social media post based on these details:
- Category: ${businessType}
- Content Focus/Instructions: ${product}
- Tone: ${tone || 'Friendly & Casual'}
- Language: ${language || 'Malay'}

PENTING:
- Sila tulis jawapan anda secara semulajadi. Jangan paksa sebarang marketing hook, jualan (hard sell), promosi, tawaran harga, atau rujukan perumahan/ejen di dalam bebenang/post ini. Ini adalah post sosial/salam santai sahaja.
- Tulis dari sudut pandang pertama (seperti "aku", "kami", "kita") yang santai mengikut tone pilihan.

${formatInstructions}

Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:
${jsonStructure}`;
            return prompt;
        }

        // Select hook library based on niche — hartanah uses property-specific hooks
        const hartanahHooks = [
            { name: 'Teaser Lokasi', pattern: 'Mulakan sebagai ejen REN yang baru dapat listing — contoh: "Baru je list satu unit kat [kawasan/area teaser] yang aku rasa korang patut tahu dulu sebelum ada orang lain jumpa." Jangan sebut nama projek atau harga di Part 1.' },
            { name: 'Curiosity Reveal', pattern: 'Mulakan dengan curiosity line — contoh: "Aku baru lepas viewing satu unit semalam. Jujur aku rasa, kalau korang tengah cari [jenis unit] kat kawasan [area teaser], korang patut scroll terus baca ni." Jangan reveal harga atau nama projek di Part 1.' },
            { name: 'Market Insight', pattern: 'Mulakan dengan penemuan pasaran hartanah — contoh: "Ramai tak sedar, masih ada unit [jenis/kawasan teaser] yang sebenarnya undervalue berbanding pasaran sekarang. Aku baru jumpa satu." Bina curiosity, jangan reveal detail di Part 1.' },
            { name: 'Buyer Scenario', pattern: 'Mulakan dengan scenario buyer yang ramai alami — contoh: "Korang tengah cari [jenis unit] tapi rasa semua yang dalam bajet dah tak ada, atau lokasi tak strategik? Aku baru dapat satu listing yang mungkin boleh tukar fikiran korang." Jangan reveal harga di Part 1.' },
            { name: 'Insider Scoop', pattern: 'Mulakan sebagai ejen yang share listing eksklusif — contoh: "Sebelum unit ni lagi ramai orang tahu, aku nak share dulu sini. Ini jenis unit yang biasanya kena grab awal — bukan sebab pressure, tapi sebab specs dia memang masuk akal." Jangan reveal nama projek atau harga di Part 1.' },
        ];

        const genericHooks = [
            { name: 'Pecahkan Mitos', pattern: 'Mulakan Slide 1 dengan format "Tahukah anda, [mitos popular/andaian salah] sebenarnya tak betul? [Terangkan kenapa / Kajian atau pengalaman tunjuk sebaliknya]..."' },
            { name: 'Kongsi Kesilapan', pattern: 'Mulakan Slide 1 dengan format "Jangan buat silap macam saya/aku dulu. [Terangkan kesilapan]. Hasilnya? [Apa berlaku]..."' },
            { name: 'Cara Luar Biasa', pattern: 'Mulakan Slide 1 dengan format "Daripada [buat cara biasa/standard], cuba [cara luar biasa/alternatif] ni untuk [manfaat]..."' },
            { name: 'Jawab Soalan', pattern: 'Mulakan Slide 1 dengan format "Soalan hari ini: [Soalan/Kemusykilan]? Jawapan: Kalau nak [manfaat], ini yang perlu anda buat..."' },
            { name: 'Tanya Soalan Gagal', pattern: 'Mulakan Slide 1 dengan format "Pernah tak cuba [dapatkan hasil] tapi gagal? Kenapa agaknya tu berlaku?..."' },
            { name: 'Minta Pendapat (A/B)', pattern: 'Mulakan Slide 1 dengan format "Ada yang kata [cara A lebih baik], yang lain kata [cara B lebih bagus]. Apa pandangan korang?..."' },
            { name: 'Testimoni / Bukti', pattern: 'Mulakan Slide 1 dengan format "Kalau [kumpulan orang/siapa] pun boleh [dapat hasil luar biasa] dengan [benda ni], korang pun mesti boleh!"' },
            { name: 'Bongkar Rahsia', pattern: 'Mulakan Slide 1 dengan format "[Manfaat] sebenarnya tak susah pun kalau tahu rahsia ni. Ini apa yang aku buat..."' }
        ];

        const hooks = nicheKey === 'hartanah' ? hartanahHooks : genericHooks;
        const chosenHook = hooks[Math.floor(Math.random() * hooks.length)];

        let prompt = "";

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
1. HOOK WAJIB — Untuk ayat pembuka Part 1, WAJIB gunakan gaya hook berikut (pilihan rawak sistem, MESTI diikut): [${chosenHook.name}] — ${chosenHook.pattern}. JANGAN guna gaya hook lain selain yang dinyatakan. JANGAN tiru atau salin bulat-bulat hook dari contoh di atas.
2. JENIS HARTANAH WAJIB TEPAT: Baca maklumat di bawah dengan teliti. Kenalpasti jenis hartanah yang sebenar (contoh: shop lot, apartment, rumah teres, bungalow, SoHo, pejabat) dan gunakan istilah YANG SAMA dalam copywriting. JANGAN tukar jenis hartanah (contoh: jangan ubah "shop lot" kepada "unit" atau "apartment"). Kalau ia shop lot, tulis pasal shop lot/kedai. Kalau ia rumah, tulis pasal rumah.
3. Sekiranya maklumat di bawah adalah topik perbincangan, perkongsian tips, atau perbandingan umum (BUKAN listing spesifik bagi unit tertentu), JANGAN reka atau hallucinate butiran unit (seperti saiz sqft, bilangan bilik, status freehold/leasehold, fasiliti, atau harga). Sebaliknya, fokus sepenuhnya untuk membincangkan topik/tips tersebut menggunakan gaya bahasa dan tone dari contoh.
4. ${nicheKey === 'hartanah' ? 'HARTANAH MYSTERY RULE: JANGAN sebut nama projek, nama pemaju, atau alamat penuh unit di dalam teks Part 1 dan Part 2. Gunakan teaser lokasi am (contoh: "kawasan Puchong", "area Cyberjaya") untuk membina curiosity sebelum reveal di bahagian akhir.' : 'PERATURAN MISTERI & CTR (CURIOSITY RULE): JANGAN sebut nama spesifik produk, nama jenama, atau model produk di dalam teks copywriting. Sebaliknya, gunakan nama am atau kata ganti misteri (seperti "benda ni", "gadget ni", "unit ni") untuk membina rasa ingin tahu (curiosity) pembaca.'}

${product}
`;
            
            let extraRules = "";
            if (nicheKey === 'hartanah') {
                // Hartanah-specific engagement rules — replace ALL generic product rules
                if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
                    extraRules = `\n\nCRITICAL HARTANAH THREAD RULES (WAJIB IKUT):
1. Tulis seperti ejen REN yang bercakap dengan kawan rapat — casual, confident, bukan corporate. Guna "aku" bukan "saya".
2. JANGAN gunakan bahasa hardsell atau fake urgency (e.g. JANGAN tulis "sebelum terlepas", "grab sekarang", "jangan tunggu", "cepat sebelum sold"). CTA mesti natural dan low-pressure.
3. STRUCTURE WAJIB: Pecahkan kepada 4-5 posting berturutan. Part 1 = Hook teaser (JANGAN reveal nama projek/harga). Part 2-3 = Build up details (size, bilik, fasiliti, lokasi). Part terakhir = Reveal harga + CTA.
4. CURIOSITY GAP untuk hartanah: Jangan reveal nama projek/pemaju atau harga di Part 1 dan Part 2. Guna teaser lokasi am (e.g. "kawasan Sepang", "area Cheras Selatan") dan hints menarik (e.g. "tanah dia luas gila", "freehold yang dah susah nak jumpa area sini") untuk buat reader scroll terus.
5. HOOK WAJIB SUDAH DITETAPKAN di atas — IKUT hook yang dinyatakan dalam arahan HOOK WAJIB. JANGAN guna gaya hook lain.
6. CTA di Part terakhir mesti natural: guna ayat seperti "Drop 'INFO' kat komen" atau "WhatsApp aku kalau nak tengok unit" — JANGAN repeat CTA dua kali dalam part yang sama.
7. Hashtag relevan letak di part terakhir sahaja.`;
                }
            } else if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
                extraRules = `\n\nCRITICAL THREADS ALGORITHM & MALAYSIAN CONVERSION RULES:
1. Write like a real human posting on Threads or Instagram. Do NOT sound like a marketer, corporate bot, or formal translator.
2. STRICTLY PROHIBIT SPAMMY/HARD SELL KEYWORDS: Never use phrases that Threads algorithm flags as spam (e.g., do NOT write "Beli sekarang", "Promo link bio", "DM untuk order", "Dapatkan segera", "Klik link").
3. USE INTERACTIVE CTA & QUESTIONS (Boosts reach by 42%): End your copy with questions or interactive prompts to drive comments (e.g. "Korang rasa?", "Setuju tak?", "Siapa pernah?", "Ada yang macam ni juga?").
4. VALUE-DRIVEN HOOKS (Prevents scroll-by): Hook the user with words that promise value (e.g. "Tips...", "Cara...", "Rahsia...", "Jangan skip...", "Baca sampai habis...").
5. PERSONAL & RELATABLE STORYTELLING (Builds Trust): Write from a first-person perspective using personal/authentic words (e.g. "Aku", "Jujur aku...", "Cerita dia...", "Pengalaman aku..."). Share as a helpful friend, not a seller.
6. CURIOSITY GAP (Do NOT satisfy curiosity too early): Avoid describing the exact physical features, specifications, or appearance of the product (e.g., do NOT mention size, color, exact button placements, or specifications). Focus entirely on the PROBLEM solved or the RESULT/TRANSFORMATION (e.g., write "sejak guna benda ni, masalah bau hapak dalam tandas terus hilang" instead of describing a deodorizer spray). Let the reader click the link to see what the item actually looks like.
7. BUYING INTENT PRIMING (Give a strong reason to buy/click): In your copywriting, build interest to purchase by mentioning trusted seller reviews, massive price drops, flash sales, or high unit sales (e.g. "Korang check sendiri review kat kedai ni, ramai kata berkesan...", "Nasib baik aku beli time tengah offer semalam...", "Aku amik dari seller ni sebab shipping terpaling laju...").
8. AVOID GENERIC MARKETING & CLICKBAIT KOSONG: Do not use empty clickbait phrases like "Korang kena tahu ni" or "Wajib tengok" if there is no real value right after. Do not start with generic bot phrases like "Mari mulakan...".
9. HOOK DIVERSITY & APPROVED PATTERNS (Vislo Hook Secrets Library): Vary your opening sentence structure. NO REPETITIVE STARTING WORDS. Use one of these high-converting hook patterns for the first sentence of Slide 1 to capture immediate attention:
   - Pecahkan Mitos: "Tahukah anda, [mitos popular] sebenarnya tak betul? Kajian/pengalaman tunjuk sebaliknya..."
   - Kongsi Kesilapan: "Jangan buat silap macam saya. [Terangkan kesilapan]. Hasilnya?..."
   - Cara Luar Biasa: "Daripada [buat cara biasa/standard], cuba [cara luar biasa] ni untuk [manfaat]..."
   - Jawab Soalan: "Soalan hari ini: [Soalan]? Jawapan: Kalau nak [manfaat], ini yang perlu anda buat..."
   - Tanya Soalan Gagal: "Pernah tak cuba [dapatkan hasil] tapi gagal? Kenapa agaknya tu berlaku?..."
   - Minta Pendapat (A/B): "Ada yang kata [cara A lebih baik], yang lain kata [cara B lebih bagus]. Apa pandangan korang?..."
   - Testimoni / Bukti: "Kalau [kumpulan orang/siapa] boleh [dapat hasil luar biasa] dengan [benda ni], korang pun mesti boleh!"
   - Bongkar Rahsia: "[Manfaat] sebenarnya tak susah pun kalau tahu rahsia ni. Ini apa yang aku buat..."
`;
            }

            
            prompt += `\n\nAdditional Requirements:\n- Tone: ${tone || 'Friendly & Casual'}\n- Language: ${language || 'Malay'}\n- ${formatInstructions}\n- PENTING: Jangan masukkan nama ejen, nombor REN/PEA/REA, nombor telefon, atau sebarang link wasap/wa.me dari maklumat produk dalam output. CTA dan maklumat hubungi akan diisi oleh sistem secara berasingan. Jangan sebut nama spesifik produk atau nama perumahan untuk membina unsur misteri.${extraRules}\n\nProvide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:\n${jsonStructure}`;

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

            // Inject niche-specific rules prominently if available (even without example_output)
            if (nicheRules && Array.isArray(nicheRules) && nicheRules.length > 0) {
                prompt += `CRITICAL NICHE RULES — You MUST follow these rules EXACTLY. These override generic copywriting guidelines:\n${nicheRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n`;
            }

            if (customInstructions) {
                prompt += `Follow these copywriting guidelines closely:\n${customInstructions}\n\n`;
            }

            if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
                prompt += `CRITICAL THREADS ALGORITHM & MALAYSIAN CONVERSION RULES:
1. Write like a real human posting on Threads or Instagram. Do NOT sound like a marketer, corporate bot, or formal translator.
2. STRICTLY PROHIBIT SPAMMY/HARD SELL KEYWORDS: Never use phrases that Threads algorithm flags as spam (e.g., do NOT write "Beli sekarang", "Promo link bio", "DM untuk order", "Dapatkan segera", "Klik link").
3. USE INTERACTIVE CTA & QUESTIONS (Boosts reach by 42%): End your copy with questions or interactive prompts to drive comments (e.g. "Korang rasa?", "Setuju tak?", "Siapa pernah?", "Ada yang macam ni juga?").
4. VALUE-DRIVEN HOOKS (Prevents scroll-by): Hook the user with words that promise value (e.g. "Tips...", "Cara...", "Rahsia...", "Jangan skip...", "Baca sampai habis...").
5. PERSONAL & RELATABLE STORYTELLING (Builds Trust): Write from a first-person perspective using personal/authentic words (e.g. "Aku", "Jujur aku...", "Cerita dia...", "Pengalaman aku..."). Share as a helpful friend, not a seller.
6. CURIOSITY GAP (Do NOT satisfy curiosity too early): Avoid describing the exact physical features, specifications, or appearance of the product (e.g., do NOT mention size, color, exact button placements, or specifications). Focus entirely on the PROBLEM solved or the RESULT/TRANSFORMATION (e.g., write "sejak guna benda ni, masalah bau hapak dalam tandas terus hilang" instead of describing a deodorizer spray). Let the reader click the link to see what the item actually looks like.
7. BUYING INTENT PRIMING (Give a strong reason to buy/click): In your copywriting, build interest to purchase by mentioning trusted seller reviews, massive price drops, flash sales, or high unit sales (e.g. "Korang check sendiri review kat kedai ni, ramai kata berkesan...", "Nasib baik aku beli time tengah offer semalam...", "Aku amik dari seller ni sebab shipping terpaling laju...").
8. AVOID GENERIC MARKETING & CLICKBAIT KOSONG: Do not use empty clickbait phrases like "Korang kena tahu ni" if there is no real value right after. Do not start with generic bot phrases like "Mari mulakan...".
9. HOOK WAJIB (MESTI IKUT — pilihan rawak sistem): Untuk ayat pembuka Slide 1, WAJIB gunakan gaya hook berikut sahaja: [${chosenHook.name}] — ${chosenHook.pattern}. JANGAN guna mana-mana gaya hook lain selain ini. Ini mengelakkan pengulangan opening yang sama berulang kali.
10. CURIOSITY & MYSTERY RULE (No Product/Brand/Project Names): NEVER mention the exact product name, brand name, model name (e.g. 'Machenike G3 V2') directly in the copywriting text. Instead, refer to it using generic, curiosity-inducing terms (e.g., 'benda ni', 'gadget ni', 'kipas ni', 'apartment ni', 'unit ni', 'benda viral ni') to create mystery and drive clicks to the destination link.
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

