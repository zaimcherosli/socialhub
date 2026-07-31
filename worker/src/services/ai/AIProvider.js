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
        if (postFormat === 'deep_thread' || postFormat === 'thread') {
            formatInstructions = `- Format: Thread / Bebenang Berangkai (DEEP). You MUST generate a sequence of exactly 4 to 5 connected slides/posts. The "caption" key in the JSON output MUST be a JSON array of strings containing these 4 to 5 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else if (postFormat === 'short_thread') {
            formatInstructions = `- Format: Thread / Bebenang Ringkas (SHORT). You MUST generate a sequence of exactly 2 to 3 connected slides/posts (no more than 3). The "caption" key in the JSON output MUST be a JSON array of strings containing these 2 to 3 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else {
            formatInstructions = `- Format: Single standalone post. The caption must be under 350 characters.`;
        }

        let jsonStructure = "";
        if (postFormat === 'deep_thread' || postFormat === 'thread') {
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

        // Humanizer Engine & Anti-AI Tropes Rules
        let toneSpecializationRules = "";
        if (tone === 'Storyteller (Pengalaman Sebenar)' || tone === 'Storyteller') {
            toneSpecializationRules = `- STORYTELLER MODE: Open directly with an authentic first-person story or recent personal discovery (e.g., "Dua hari lepas masa aku...", "Dulu aku pernah silap...", "Minggu lepas ada sorang kawan bagitahu..."). Share thoughts, hesitation, and the eventual realization like talking to a close friend.`;
        } else if (tone === 'Hot Take (Pecah Mitos / Contrarian)' || tone === 'Hot Take') {
            toneSpecializationRules = `- HOT TAKE / MYTH BUSTING MODE: Open with a bold, controversial, or myth-busting statement (e.g., "Ramai orang salah faham pasal...", "Stop buat benda ni kalau tak nak...", "Mitos paling besar yang ramai orang percaya..."). Explain why common wisdom fails with sharp logic.`;
        } else if (tone === 'Sembang Santai (Slang Melayu Asli)' || tone === 'Sembang Santai') {
            toneSpecializationRules = `- SEMBANG SANTAI MODE: Write in ultra-casual Malaysian Threads slang ("gila", "kot", "weh", "haritu", "mat", "tak masuk akal", "jer", "siot", "dulu-dulu", "plak"). Relaxed, effortless, like a WhatsApp group chat.`;
        } else if (tone === 'Punchy & Minimalist' || tone === 'Minimalist') {
            toneSpecializationRules = `- PUNCHY & MINIMALIST MODE: Ultra-concise line-by-line micro thoughts (3-6 words per line max). Zero fluff, high impact, clean vertical spacing.`;
        } else if (tone === 'Ultra-Realistic Malay') {
            toneSpecializationRules = `- ULTRA-REALISTIC MALAY MODE: Mix Malay and English (Manglish) naturally like top Malaysian Threads creators ("literally", "time tu", "which is", "I mean", "serious talk", "gila").`;
        } else {
            toneSpecializationRules = `- TONE MODE: ${tone || 'Friendly & Casual'}`;
        }

        const antiAiTropesPromptBlock = `
CRITICAL HUMANIZER ENGINE & STRICT ANTI-AI RULES (MANDATORY TO SOUND 100% LIKE A REAL HUMAN THREADS CREATOR):
1. ABSOLUTELY FORBIDDEN CLICHÉ AI PHRASES (NEVER USE THESE IN MALAY OR ENGLISH):
   - ABSOLUTELY FORBIDDEN IN MALAY: "Secara jujurnya", "Sebenarnya", "Bukan itu sahaja", "Secara keseluruhannya", "Menariknya", "Tahu tak...", "Siapa kat sini yang...", "Impak positif", "Dalam era moden ini", "Terokai", "Sesungguhnya", "Sememangnya", "Tak dinafikan", "Mari kita", "Di samping itu", "Lanjutan daripada itu", "Sejujurnya", "Usah pening", "Ingin tahu", "Sedia berkhidmat".
   - ABSOLUTELY FORBIDDEN IN ENGLISH: "In today's fast-paced world", "Look no further", "Game changer", "At the end of the day", "In conclusion", "Unlock the potential", "Elevate your", "Delve into", "Furthermore", "Moreover", "Tired of...", "Are you looking for...", "In this digital age".

2. DYNAMIC CONVERSATIONAL RHYTHM & TEMPO (Vary sentence lengths):
   - Combine ultra-short 2-to-4 word punchy fragments (e.g., "Sumpah tak sangka.", "Realiti pahit.", "Benda simple je.") with medium conversational sentences.
   - Use micro-paragraphs (1 to 2 lines per paragraph maximum with line breaks) for smooth, addicting mobile reading.
   - Never make all sentences equal length or write long walls of text.

3. TONE & COPYWRITING ANGLE SPECIALIZATION:
   ${toneSpecializationRules}
`;

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

${antiAiTropesPromptBlock}

Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks, explanations, or additional text:
${jsonStructure}`;
            return prompt;
        }

        // Select hook library based on niche — hartanah uses property-specific hooks
        const hartanahHooks = [
            { name: 'REN Personal Finding (Dapat Listing Rare)', pattern: 'Mulakan dari sudut pandang ejen REN yang teruja baru dapat listing — contoh: "Aku baru je dapat 1 listing kat area [kawasan/area teaser] ni. Lain macam betul rumah dia, rugi sangat kalau korang tak tengok dulu..." Jangan sebut nama projek atau harga di Part 1.' },
            { name: 'REN Viewing Reaction', pattern: 'Mulakan dari sudut pandang ejen yang baru selesai viewing — contoh: "Baru balik dari viewing satu unit kat [kawasan/area teaser]. Sumpah aku terkejut tengok condition & layout rumah ni, betul-betul tak expect deal macam ni..." Jangan sebut nama projek atau harga di Part 1.' },
            { name: 'Teaser Lokasi', pattern: 'Mulakan sebagai ejen REN yang baru dapat listing — contoh: "Baru je list satu unit kat [kawasan/area teaser] yang aku rasa korang patut tahu dulu sebelum ada orang lain jumpa." Jangan sebut nama projek atau harga di Part 1.' },
            { name: 'Curiosity Reveal', pattern: 'Mulakan dengan curiosity line — contoh: "Aku baru lepas viewing satu unit semalam. Jujur aku rasa, kalau korang tengah cari [jenis unit] kat kawasan [area teaser], korang patut scroll terus baca ni." Jangan reveal harga atau nama projek di Part 1.' },
            { name: 'Market Insight', pattern: 'Mulakan dengan penemuan pasaran hartanah — contoh: "Ramai tak sedar, masih ada unit [jenis/kawasan teaser] yang sebenarnya undervalue berbanding pasaran sekarang. Aku baru jumpa satu." Bina curiosity, jangan reveal detail di Part 1.' },
            { name: 'Buyer Scenario', pattern: 'Mulakan dengan scenario buyer yang ramai alami — contoh: "Korang tengah cari [jenis unit] tapi rasa semua yang dalam bajet dah tak ada, atau lokasi tak strategik? Aku baru dapat satu listing yang mungkin boleh tukar fikiran korang." Jangan reveal harga di Part 1.' },
            { name: 'Insider Scoop', pattern: 'Mulakan sebagai ejen yang share listing eksklusif — contoh: "Sebelum unit ni lagi ramai orang tahu, aku nak share dulu sini. Ini jenis unit yang biasanya kena grab awal — bukan sebab pressure, tapi sebab specs dia memang masuk akal." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'REN Secret Tip', pattern: 'Sebagai REN yang dah biasa tengok macam-macam unit, jarang aku jumpa layout yang betul-betul kena dengan harga macam unit kat [kawasan/area teaser] ni. Jangan sebut nama projek atau harga di Part 1.' },
            { name: 'Urgent Owner (Desperate Sale)', pattern: 'Mulakan dengan khabar terdesak dari owner — contoh: "Ada berita kurang best tapi peluang baik untuk buyer. Owner unit kat [kawasan/area teaser] ni terpaksa let go cepat sebab nak cash out. Harga dia..." Jangan reveal nama projek di Part 1.' },
            { name: 'Comparative Analysis (Renovation/Value)', pattern: 'Mulakan dengan perbandingan kos reno — contoh: "Kalau korang beli unit sub-sale yang kena reno teruk, kos dia boleh cecah ratus ribu. Tapi unit kat [kawasan/area teaser] ni, owner dah buat ID gempak gila. Korang masuk cuci kaki je..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Rental Yield Potential', pattern: 'Mulakan dengan potensi hasil sewa — contoh: "Ramai tak tahu, ada satu spot kat [kawasan/area teaser] yang yield sewa dia sangat sihat sekarang. Aku baru jumpa satu unit yang positive cashflow..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Zero Downpayment / Low Entry Teaser', pattern: 'Mulakan dengan kelayakan kemasukan rendah — contoh: "Tengah cari rumah tapi simpanan cash tak banyak untuk deposit? Ada satu projek/unit kat [kawasan/area teaser] yang pakej dia sangat mesra first-time buyer..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Family Growth / Upgrade Space', pattern: 'Mulakan dengan isu menaik taraf saiz rumah — contoh: "Anak dah makin membesar tapi still duduk rumah sempit? Dah tiba masa kena upgrade. Aku ada satu listing kat [kawasan/area teaser] yang layout dia memang mesra family..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Gated & Guarded Privacy', pattern: 'Mulakan dengan privasi & kawalan keselamatan — contoh: "Bagi yang utamakan safety & privacy untuk family, korang patut tengok unit kat [kawasan/area teaser] ni. Gated guarded, komuniti pun sangat tenang..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Direct View / High Floor Perk', pattern: 'Mulakan dengan tarikan pemandangan balkoni — contoh: "Sumpah view dari balkoni unit kat [kawasan/area teaser] ni memang mahal gila. Setiap kali balik kerja petang, korang boleh layan sunset tenang-tenang..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Strategic Access (Transit Oriented)', pattern: 'Mulakan dengan akses strategik awam — contoh: "Paling menyampah bila nak pergi kerja kena hadap jem sejam dua. Sebab tu ramai orang rebut unit kat [kawasan/area teaser] ni, sebab jalan kaki je pergi MRT/LRT..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Undervalued Subsale Find', pattern: 'Mulakan dengan unit di bawah harga pasaran — contoh: "Minggu ni aku jumpa satu unit subsale kat [kawasan/area teaser] yang owner dia jual bawah market value (MV) gila-gila. Memang rare nak dapat deal macam ni..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Fully Furnished Bargain', pattern: 'Mulakan dengan kelebihan perabot penuh — contoh: "Daripada pening kepala fikir kos beli perabot & barang elektrik yang makin mahal, baik korang tengok unit kat [kawasan/area teaser] ni. Semua owner bagi sekali..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Retirement / Peaceful Area', pattern: 'Mulakan dengan ketenangan kawasan matang — contoh: "Bila dah berumur sikit, kita mesti nak tempat tinggal yang tak bising dan kejiranan yang matang. Unit kat [kawasan/area teaser] ni memang sangat sesuai..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Modern Minimalist Layout', pattern: 'Mulakan dengan tarikan konsep moden — contoh: "Bagi peminat konsep minimalist & open-concept layout, unit kat [kawasan/area teaser] ni memang sebiji macam dalam Pinterest. Cantik gila..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Low Density Exclusive', pattern: 'Mulakan dengan kelebihan kepadatan rendah — contoh: "Paling leceh duduk high-rise yang kena berebut lif tiap-tiap pagi. Tapi unit subsale kat [kawasan/area teaser] ni low density gila, satu floor ada beberapa unit je..." Jangan reveal nama projek atau harga di Part 1.' },
            { name: 'Quick Grab Opportunity', pattern: 'Mulakan dengan tempoh tawaran terhad — contoh: "Aku jarang buat post macam ni, tapi unit kat [kawasan/area teaser] ni memang hot item. Baru semalam list, dah ada 3 orang request viewing. Siapa cepat dia dapat..." Jangan reveal nama projek atau harga di Part 1.' }
        ];

        const genericHooks = [
            { name: 'Kongsi Kesilapan', pattern: 'Mulakan Slide 1 dengan format "Jangan buat silap macam saya/aku dulu. [Terangkan kesilapan]. Hasilnya? [Apa berlaku]..."' },
            { name: 'Cara Luar Biasa', pattern: 'Mulakan Slide 1 dengan format "Daripada [buat cara biasa/standard], cuba [cara luar biasa/alternatif] ni untuk [manfaat]..."' },
            { name: 'Jawab Soalan', pattern: 'Mulakan Slide 1 dengan format "Ramai tanya aku pasal [topik/soalan]. Sebenarnya senang je, kalau nak [manfaat], ini yang perlu buat..."' },
            { name: 'Tanya Soalan Gagal', pattern: 'Mulakan Slide 1 dengan format "Pernah tak cuba [dapatkan hasil] tapi gagal? Kenapa agaknya tu berlaku?..."' },
            { name: 'Minta Pendapat (A/B)', pattern: 'Mulakan Slide 1 dengan format "Ada yang kata [cara A lebih baik], yang lain kata [cara B lebih bagus]. Apa pandangan korang?..."' },
            { name: 'Testimoni / Bukti', pattern: 'Mulakan Slide 1 dengan format "Kalau [kumpulan orang/siapa] pun boleh [dapat hasil luar biasa] dengan [benda ni], korang pun mesti boleh!"' },
            { name: 'Bongkar Rahsia', pattern: 'Mulakan Slide 1 dengan format "[Manfaat] sebenarnya tak susah pun kalau tahu rahsia ni. Ini apa yang aku buat..."' },
            { name: 'Pengakuan Peribadi', pattern: 'Mulakan Slide 1 dengan format "Aku nak buat pengakuan sikit. Dulu aku fikir normal lah kalau [masalah], rupa-rupanya..."' },
            { name: 'Realiti Pahit', pattern: 'Mulakan Slide 1 dengan format "Satu benda yang aku baru belajar: Kalau korang masih [buat kesilapan], sampai bila-bila pun takkan..."' },
            { name: 'Pemerhatian Santai', pattern: 'Mulakan Slide 1 dengan format "Korang perasan tak, sejak kebelakangan ni susah sangat nak [manfaat]? Rupa-rupanya..."' },
            { name: 'Curiosity Teaser', pattern: 'Mulakan Slide 1 dengan format "Sumpah aku menyesal lambat tahu pasal benda ni. Kalau la dari awal aku start..."' },
            { name: 'Sebelum & Selepas (Before & After)', pattern: 'Mulakan Slide 1 dengan format "Korang kena tengok beza sebelum dan selepas aku guna/buat benda ni. Perubahan dia memang buat aku terkejut gila..."' },
            { name: 'Pelaburan Berbaloi (Smart Investment)', pattern: 'Mulakan Slide 1 dengan format "Duit habis beli benda merepek? Ini satu benda paling berbaloi yang aku beli tahun ni. Guna tiap-tiap hari tanpa jemu..."' },
            { name: 'Penyelamat Keadaan (Lifesaver Scenario)', pattern: 'Mulakan Slide 1 dengan format "Sesiapa yang selalu hadapi masalah [masalah], korang patut tahu pasal benda ni. Sumpah penyelamat keadaan betul..."' },
            { name: 'Perbandingan Kos (Price-to-Value)', pattern: 'Mulakan Slide 1 dengan format "Daripada korang bazir beratus ringgit sebulan untuk [alternatif mahal], ada alternatif jauh lebih murah tapi kualiti/hasil dia sebiji sama..."' },
            { name: 'Tips Produktiviti / Jimat Masa', pattern: 'Mulakan Slide 1 dengan format "Macam mana aku jimat masa 2 jam setiap hari daripada hadap benda ni? Rahsia dia rupanya simple sangat..."' },
            { name: 'Trending / Viral Alert', pattern: 'Mulakan Slide 1 dengan format "Mula-mula aku ingat benda ni viral kosong je kat media sosial. Tapi lepas aku try sendiri, baru aku faham kenapa ramai orang obses sangat..."' },
            { name: 'Rekomendasi Rakan Rapat', pattern: 'Mulakan Slide 1 dengan format "Jujur aku takkan recommend benda ni kalau aku sendiri tak nampak hasil dia. Tapi selepas sebulan konsisten, ini apa yang berlaku..."' },
            { name: 'Sebab Utama / Mengapa', pattern: 'Mulakan Slide 1 dengan format "Ini 3 sebab utama kenapa ramai orang masih gagal untuk dapatkan [manfaat], walaupun dah guna macam-macam cara..."' },
            { name: 'Peringatan Mesra / Wake-up Call', pattern: 'Mulakan Slide 1 dengan format "Stop buat benda ni kalau korang masih nak [manfaat]. Korang sebenarnya tengah bazir tenaga & masa je kalau tak ubah cara..."' }
        ];

        // Dynamic Hook Selection — Shuffle & randomly pick primary & candidate hooks per generation
        const baseHooksList = nicheKey === 'hartanah' ? hartanahHooks : genericHooks;
        const shuffledHooks = [...baseHooksList].sort(() => 0.5 - Math.random());
        const primaryHook = shuffledHooks[0];
        const secondaryHooks = shuffledHooks.slice(1, 5);

        const hooksInstructions = `FOKUS GAYA HOOK UTAMA KALI INI (DYNAMIC VARIATION):
- ${primaryHook.name}: ${primaryHook.pattern}

CADANGAN GAYA ALTERNATIF (Boleh pilih jika lebih sepadan dengan konteks):
${secondaryHooks.map(h => `- ${h.name}: ${h.pattern}`).join('\n')}

PERATURAN PELBAGAIAN HOOK (ANTI-REPETITION):
1. JANGAN GUNA AYAT PEMBUKA KLISE ATAU BERULANG. Setiap kali anda menulis, pastikan ayat pembuka Slide 1/Part 1 mempunyai kelainan penuh dari segi emosi, ekspresi, dan struktur.
2. JANGAN mulakan dengan frasa bosan seperti "Korang tahu tak...", "Adakah anda mencari...", "Secara jujurnya...", "Tahu tak korang...".
3. Mulakan terus dengan kejutan, ekspresi realistik (e.g. "Sumpah aku terkejut...", "Dua minggu lepas aku perasan...", "Ramai silap bab ni..."), atau situasi sebenar ejen/pengguna.`;

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
1. HOOK SELECTION (DYNAMIC ROTATION): Sila ikuti arahan gaya hook terpilih di bawah. Anda WAJIB memulakan ayat pertama di Slide 1 mengikut gaya hook yang ditetapkan untuk memastikan kelainan dan permulaan yang segar. JANGAN mulakan dengan ayat pembuka biasa/templat generic.
2. JENIS HARTANAH WAJIB TEPAT: Baca maklumat di bawah dengan teliti. Kenalpasti jenis hartanah yang sebenar (contoh: shop lot, apartment, rumah teres, bungalow, SoHo, pejabat) dan gunakan istilah YANG SAMA dalam copywriting. JANGAN tukar jenis hartanah (contoh: jangan ubah "shop lot" kepada "unit" atau "apartment"). Kalau ia shop lot, tulis pasal shop lot/kedai. Kalau ia rumah, tulis pasal rumah.
3. Sekiranya maklumat di bawah adalah topik perbincangan, perkongsian tips, atau perbandingan umum (BUKAN listing spesifik bagi unit tertentu), JANGAN reka atau hallucinate butiran unit (seperti saiz sqft, bilangan bilik, status freehold/leasehold, fasiliti, atau harga). Sebaliknya, fokus sepenuhnya untuk membincangkan topik/tips tersebut menggunakan gaya bahasa dan tone dari contoh.
4. ${nicheKey === 'hartanah' ? 'HARTANAH MYSTERY RULE: JANGAN sebut nama projek, nama pemaju, atau alamat penuh unit di dalam teks Part 1 dan Part 2. Gunakan teaser lokasi am (contoh: "kawasan Puchong", "area Cyberjaya") untuk membina curiosity sebelum reveal di bahagian akhir.' : 'PERATURAN MISTERI & CTR (CURIOSITY RULE): JANGAN sebut nama spesifik produk, nama jenama, atau model produk di dalam teks copywriting. Sebaliknya, gunakan nama am atau kata ganti misteri (seperti "benda ni", "gadget ni", "unit ni") untuk membina rasa ingin tahu (curiosity) pembaca.'}

${antiAiTropesPromptBlock}

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
5. HOOK SELECTION & DYNAMIC VARIATION: Sila ikuti panduan gaya hook terpilih di bawah untuk memulakan Part 1/Slide 1. JANGAN mendedahkan nama projek atau harga di Part 1.
6. CTA di Part terakhir mesti natural: guna ayat seperti "Drop 'INFO' kat komen" atau "WhatsApp aku kalau nak tengok unit" — JANGAN repeat CTA dua kali dalam part yang sama.
7. Hashtag relevan letak di part terakhir sahaja.

[Vislo Dynamic Hook Engine - Hartanah]:
${hooksInstructions}`;
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
8. AVOID GENERIC MARKETING & CLICKBAIT KOSONG: Do not use empty clickbait phrases like "Korang kena tahu ni" if there is no real value right after. Do not start with generic bot phrases like "Mari mulakan...".
9. HOOK SELECTION (Vislo Dynamic Hook Engine - General): Follow this dynamic hook selection for Slide 1:
${hooksInstructions}
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

            // Inject Humanizer Engine and Anti-AI Tropes rules
            prompt += `${antiAiTropesPromptBlock}\n\n`;

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
9. HOOK SELECTION (WAJIB PILIH SATU GAYA): Untuk ayat pembuka Slide 1, sila pilih salah satu daripada gaya hook di dalam [Vislo Hook Secrets Library] di bawah yang paling sepadan dengan topik penulisan anda. Anda WAJIB memulakan ayat pertama di Slide 1 mengikut gaya hook yang dipilih untuk memastikan permulaan yang natural dan menarik. JANGAN gunakan perkataan pembuka standard seperti "Pernah tak" atau "Tahukah anda" melainkan dinyatakan dalam hook yang dipilih:
${hooksInstructions}
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

