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
        if (postFormat === 'mega_thread') {
            formatInstructions = `- Format: Thread / Bebenang Panjang (MEGA STORY). You MUST generate a sequence of exactly 7 to 10 connected slides/posts. The "caption" key in the JSON output MUST be a JSON array of strings containing these 7 to 10 slides in order. Each individual slide/post string in the array must be under 280 characters and carry a suspenseful or engaging storytelling progression.`;
        } else if (postFormat === 'deep_thread' || postFormat === 'thread') {
            formatInstructions = `- Format: Thread / Bebenang Berangkai (DEEP). You MUST generate a sequence of exactly 4 to 5 connected slides/posts. The "caption" key in the JSON output MUST be a JSON array of strings containing these 4 to 5 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else if (postFormat === 'short_thread') {
            formatInstructions = `- Format: Thread / Bebenang Ringkas (SHORT). You MUST generate a sequence of exactly 2 to 3 connected slides/posts (no more than 3). The "caption" key in the JSON output MUST be a JSON array of strings containing these 2 to 3 slides in order. Each individual slide/post string in the array must be under 300 characters.`;
        } else {
            formatInstructions = `- Format: Single standalone post. The caption must be under 350 characters.`;
        }

        let jsonStructure = "";
        if (postFormat === 'mega_thread') {
            jsonStructure = `{
  "caption": [
    "Slide 1 hook under 280 characters",
    "Slide 2 content under 280 characters",
    "Slide 3 content under 280 characters",
    "Slide 4 content under 280 characters",
    "Slide 5 content under 280 characters",
    "Slide 6 content under 280 characters",
    "Slide 7 content under 280 characters",
    "Slide 8 content under 280 characters"
  ],
  "cta": "write the call-to-action here",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;
        } else if (postFormat === 'deep_thread' || postFormat === 'thread') {
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
        if (tone === 'Skeptikal / Ingat Scam Tapi Padu' || tone?.includes('Skeptikal') || tone?.includes('Scam')) {
            toneSpecializationRules = `- SKEPTICAL / VIRAL TESTER MODE (FORMULA A - HIGHEST CONVERSION):
  * Slide 1 Hook: Open with heavy skepticism and distrust (e.g., "Mula-mula aku ingat benda ni viral kosong je / gimmick semata-mata. Mana ada barang harga macam ni boleh berkesan...", "Sejujurnya aku rasa membazir gila beli benda ni mula-mula...").
  * Story progression: Share why you hesitated, why you finally took a gamble (desperate / cheap promo), and the shocking turning point when it actually worked better than expected.
  * Comment Magnet: Include a casual question in Slide 1/2 like "Korang kalau beli barang viral selalu terkena scam ke atau betul-betul menjadi?".
  * Zero Hard-Sell: Never praise the product blindly. Sound like an honest consumer who was proven wrong.`;
        } else if (tone === 'Confession / Masalah Malu & Tabu' || tone?.includes('Malu') || tone?.includes('Tabu') || tone?.includes('Confession')) {
            toneSpecializationRules = `- TABOO / EMBARRASSING CONFESSION MODE (FORMULA B - VIRAL REACH & HIGH REPLIES):
  * Slide 1 Hook: Open with an awkward, embarrassing, or relatable taboo moment (e.g., "Sumpah rasa nak sorok muka semalam bila kawan tumpang kereta. Boleh pulak benda tu keluar melintas depan mata...", "Malu gila bila orang tegur pasal masalah ni...").
  * Story progression: Relatable struggle with bad smells, messy clutter, hidden pests, embarrassing hygiene/skin issues, or dirty spots. Describe the emotional relief after finding a discreet, cheap lifesaver.
  * Comment Magnet: Prompt readers to relate (e.g., "Korang pernah tak kena situasi paling malu macam ni depan orang lain?").`;
        } else if (tone === 'Kalaulah Tahu Dari Dulu / Jimat Duit' || tone?.includes('Kalaulah Tahu') || tone?.includes('Jimat Duit') || tone?.includes('Lifehack')) {
            toneSpecializationRules = `- COSTLY MISTAKES VS SMART LIFEHACK (FORMULA C - HIGH SAVE RATE & VALUE):
  * Slide 1 Hook: Open with regret over wasted money/time (e.g., "Kalaulah dari dulu aku tahu trik ni wujud, takde lah melayang beratus ringgit setiap bulan...", "Silap besar aku bayar mahal-mahal selama ni...").
  * Story progression: Contrast the previous expensive/tedious method (expensive workshop, salon, professional cleaning, expensive branded items) with this easy DIY alternative that costs a fraction.
  * Comment Magnet: Ask "Berapa banyak duit korang dah habis sebelum sedar benda tu boleh buat sendiri?".`;
        } else if (tone === 'Bait Debat / Tanya Pendapat' || tone?.includes('Bait Debat') || tone?.includes('Pendapat') || tone?.includes('Debate')) {
            toneSpecializationRules = `- DEBATE & OPINION BAIT MODE (FORMULA D - ALGORITHM COMMENT ACCELERATOR):
  * Slide 1 Hook: Open with a polarizing daily dilemma or habits debate (e.g., "Korang jenis yang sanggup biar [masalah harian] atau jenis yang tak boleh tidur kalau tak settle kan benda ni? Sebab aku...", "Antara dua cara ni, mana satu yang korang rasa masuk akal?").
  * Story progression: Present two opposing perspectives or habits, explain why most people struggle with the common method, then casually share what works best.
  * Comment Magnet: Prompt comments with "Cer korang bagi pendapat kat komen, korang team mana satu?".`;
        } else if (tone === 'Auto-Smart Viral Angle' || tone?.includes('Auto-Smart')) {
            toneSpecializationRules = `- AUTO-SMART VIRAL ANGLE MODE (DYNAMIC HIGH CONVERSION):
  * Analyze the product context: If it solves a hygiene/pest/car/embarrassing problem -> use Taboo/Confession angle. If it is a gadget/tool/skincare -> use Skeptical/Scam angle or Costly Mistakes angle. If it is lifestyle/organization/fashion -> use Debate/Opinion angle.
  * Always ensure Slide 1 contains a strong human emotional hook and Slide 1/2 contains a comment magnet question.`;
        } else if (tone === 'Storyteller (Pengalaman Sebenar)' || tone === 'Storyteller') {
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

3. ZERO HARD-SELLING & COMMENT MAGNET STRATEGY:
   - NEVER praise the product in Slide 1. Slide 1 MUST be 100% about the human emotion, conflict, taboo confession, or skepticism.
   - In Slide 1 or Slide 2, always embed a natural question or debate prompt to stimulate comments from readers (Algorithm views are powered by replies!).
   - Keep product mention subtle until the second half (80% story/problem, 20% solution).

4. TONE & COPYWRITING ANGLE SPECIALIZATION:
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
        // Select hook library based on niche — hartanah uses 20 property-specific evergreen REN POV hooks
        const hartanahHooks = [
            { name: 'Commercial & Business Tapak Match', pattern: 'Mulakan dengan cadangan tapak bisnes/HQ — contoh: "Kalau korang tengah cari tapak bisnes, HQ atau branch baru kat [kawasan/area teaser], unit 3-tingkat corner lot ni antara spot paling berbaloi..." Jangan sebut harga di Part 1.' },
            { name: 'Rare Listing & Specs Spotlight', pattern: 'Mulakan dengan keunikan specs unit — contoh: "Unit corner lot dengan built-up seluas ni memang jarang kosong lama kat area [kawasan/area teaser]..." Jangan reveal harga di Part 1.' },
            { name: 'Rental Market & ROI Comparison', pattern: 'Mulakan dengan perbandingan kadar pasaran — contoh: "Kadar sewa commercial lot kat area [kawasan/area teaser] biasanya agak keras, tapi unit ni owner offer deal yang masuk akal gila..." Jangan reveal harga di Part 1.' },
            { name: 'REN Advisory & Due Diligence', pattern: 'Mulakan sebagai ejen REN yang bagi tips tapak — contoh: "Antara benda pertama aku check bila client nak sewa commercial lot kat [kawasan/area teaser] adalah parking & visibility dari jalan utama..." Jangan reveal nama projek di Part 1.' },
            { name: 'Debate / Option Dilemma', pattern: 'Mulakan dengan soalan pilihan strategik — contoh: "Untuk bisnes korang, lebih untung sewa ground floor sahaja ke sewa satu blok 3 tingkat terus? Cer tengok kiraan untuk unit kat [kawasan/area teaser] ni..."' },
            { name: 'High Foot Traffic & Visibility', pattern: 'Mulakan dengan faktor lokasi & visibility — contoh: "Signboard kalau pasang kat corner lot ni memang nampak dari jauh. Spot kat [kawasan/area teaser] ni memang tumpuan flow kereta..." Jangan reveal nama projek di Part 1.' },
            { name: 'Move-in Condition & Reno Savings', pattern: 'Mulakan dengan penjimatan kos reno — contoh: "Daripada sewa unit bare yang kena modal puluhan ribu nak setup, unit kat [kawasan/area teaser] ni dah siap kemas, terus jimat kos permulaan bisnes..."' },
            { name: 'REN Banker & Loan Advisory', pattern: 'Mulakan sebagai ejen REN yang menguruskan kelayakan — contoh: "Ramai ingat nak beli/sewa unit commercial susah nak lepas dokumen. Bila susun elok-elok ikut profile syarikat, proses dia smooth je..."' },
            { name: 'Rent vs Own Reality Check', pattern: 'Mulakan dengan kesedaran kewangan hartanah — contoh: "Bila kira balik komitmen bulanan berbanding keluasan square feet yang korang dapat kat [kawasan/area teaser] ni, memang terasa beza value dia..."' },
            { name: 'Subsale vs Undercon Trade-off', pattern: 'Mulakan sebagai ejen REN yang memberi nasihat pemilihan hartanah — contoh: "Antara soalan paling kerap client tanya aku: berbaloi ke ambil unit yang dah siap berbanding tunggu projek baru? Ini fakta sebenar..."' },
            { name: 'Strategic Access & Highway Connectivity', pattern: 'Mulakan dengan akses logistik & jalan raya — contoh: "Lokasi yang direct access ke highway utama memang jimatkan masa team & customer korang. Macam unit kat [kawasan/area teaser] ni..."' },
            { name: 'Family Growth & Space Upgrade', pattern: 'Mulakan dengan keperluan ruang yang lebih selesa — contoh: "Bila ruang dah mula sempit, memang sampai masa kena cari unit yang ada extra space & bilik yang lapang..."' },
            { name: 'Rental Yield & Potential Cashflow', pattern: 'Mulakan dengan potensi pelaburan — contoh: "Permintaan sewa kat kawasan [kawasan/area teaser] ni memang konsisten tinggi sebab demand dari penduduk sekitar..."' },
            { name: 'Emergency Owner Direct Offer', pattern: 'Mulakan dengan tawaran eksklusif dari owner — contoh: "Owner unit kat [kawasan/area teaser] ni memang buka peluang sewa/jual dengan rate yang sangat berpatutan untuk kemasukan segera..."' },
            { name: 'LPPSA & First Home Scheme', pattern: 'Mulakan dengan pakej bantuan pembelian — contoh: "Bagi yang tengah survey rumah pertama guna pakej gov atau bank, ada beberapa unit kat [kawasan/area teaser] yang syarat kelayakan dia mesra pembeli..."' },
            { name: 'Gated & Guarded Security', pattern: 'Mulakan dengan ciri keselamatan & ketenangan — contoh: "Persekitaran yang tersusun dan ada kawalan sekuriti 24 jam memang jadi keutamaan ramai sekarang ni..."' },
            { name: 'Low Density & Exclusive Setting', pattern: 'Mulakan dengan privasi & keselesaan — contoh: "Kalau korang jenis yang tak suka kawasan terlalu sesak dan bising, persekitaran kat [kawasan/area teaser] ni memang tenang..."' },
            { name: 'Dah Extend & Full Spec', pattern: 'Mulakan dengan ulasan ruang tambahan — contoh: "Layout unit ni memang praktikal sebab setiap sudut dimanfaatkan sepenuhnya tanpa perlu ubah suai besar..."' },
            { name: 'Auction vs Subsale Guide', pattern: 'Mulakan dengan panduan hartanah jujur — contoh: "Sebelum decide nak lock mana-mana hartanah, pastikan korang dah semak 3 perkara asas ni dulu..."' },
            { name: 'Curiosity Feature Teaser', pattern: 'Mulakan dengan teaser kelebihan tersembunyi — contoh: "Ada satu kelebihan besar pada unit kat [kawasan/area teaser] ni yang ramai orang terlepas pandang bila tengok dari luar..."' }
        ];

        const pembiayaanHooks = [
            { name: 'Gaji vs Komitmen Bersih (Cashflow Reality)', pattern: 'Mulakan dengan realiti komitmen slip gaji — contoh: "Gaji atas kertas nampak RM5,000, tapi bila tolak komitmen 3 kad kredit & 2 personal loan, baki tunai bersih tinggal berapa ratus je..."' },
            { name: 'Kelegaan Penyatuan Hutang (Debt Consolidation)', pattern: 'Mulakan dengan solusi jimat bayaran bulanan — contoh: "Ramai yang tak sedar, bila gabungkan beberapa hutang interest tinggi ke dalam satu skim pembiayaan bank/koperasi, bayaran bulanan boleh jimat sampai RM1,000+ sebulan..."' },
            { name: 'CCRIS & CTOS Recovery Checklist', pattern: 'Mulakan dengan panduan skor kredit & tunggakan — contoh: "Bila rekod CCRIS mula sangkut sebab terlambat bayar kad kredit atau loan lama, ini langkah pertama yang wajib buat sebelum apply mana-mana fasiliti baru..."' },
            { name: 'Kakitangan Kerajaan 60% DSR Overlap', pattern: 'Mulakan dengan situasi staf gov/badan berkanun — contoh: "Bagi kakitangan kerajaan yang potongan payslip dah dekat 60%, ada fasiliti koperasi khas yang boleh bantu overlap untuk rendahkan komitmen bulanan..."' },
            { name: 'Beban Minimum Payment Kad Kredit', pattern: 'Mulakan dengan bahaya bayar minimum kad kredit — contoh: "Bayar minimum payment kad kredit setiap bulan sebenarnya ibarat bayar interest semata-mata tanpa kurangkan hutang pokok..."' },
            { name: 'Semakan Kelayakan & DSR Percuma', pattern: 'Mulakan dengan tips semak kelayakan sebelum apply — contoh: "Sebelum submit permohonan ke mana-mana institusi, penting untuk kira Debt Service Ratio (DSR) dulu supaya profile tak kena reject..."' }
        ];

        // Dynamic Hook Selection
        const isPropertyContent = nicheKey === 'hartanah' || (product && /\b(condo|kondo|rumah|apartment|teres|sewa|jual|unit|landed|shop\s*lot|built-up|sqft|hartanah|listing|viewing)\b/i.test(product));
        const isPembiayaanContent = nicheKey === 'pembiayaan' || (product && /\b(pembiayaan|pinjaman|personal\s*loan|koperasi|overlap|penyatuan\s*hutang|debt\s*consolidation|ccris|ctos|dsr|slip\s*gaji|potongan\s*gaji|angkasa|kakitangan\s*awam|penjawat\s*awam)\b/i.test(product));
        
        let hooksInstructions = "";
        if (isPropertyContent) {
            const shuffledHooks = [...hartanahHooks].sort(() => 0.5 - Math.random());
            const primaryHook = shuffledHooks[0];
            const secondaryHooks = shuffledHooks.slice(1, 4);

            hooksInstructions = `FOKUS PERSPEKTIF EJEN REN (DYNAMIC ADVISORY ROTATION):
- Sudut Utama: ${primaryHook.name} — ${primaryHook.pattern}
- Sudut Alternatif:
${secondaryHooks.map(h => `- ${h.name}: ${h.pattern}`).join('\n')}

PERATURAN PELBAGAIAN HOOK (ANTI-REPETITION & TIME-AGNOSTIC):
1. DILARANG SAMA SEKALI GUNA AYAT BERUNSUR MASA SEMPIT SEPERTI "Baru balik viewing...", "Baru lepas inspect...", "Tadi petang baru tengok unit...". Gunakan pembuka yang evergreen, profesional dan santai!
2. JANGAN GUNA AYAT PEMBUKA KLISE ATAU BERULANG. Setiap post mesti ada gaya intro berbeza (ulas analisa tapak, perbandingan sewa, kemudahan, akses).
3. JANGAN mulakan dengan frasa bosan seperti "Korang tahu tak...", "Adakah anda mencari...", "Secara jujurnya...", "Tahu tak korang...".`;
        } else if (isPembiayaanContent) {
            const shuffledHooks = [...pembiayaanHooks].sort(() => 0.5 - Math.random());
            const primaryHook = shuffledHooks[0];
            const secondaryHooks = shuffledHooks.slice(1, 4);

            hooksInstructions = `FOKUS PERSPEKTIF KONSULTAN / ADVISOR PEMBIAYAAN (DYNAMIC LOAN ROTATION):
- Sudut Utama: ${primaryHook.name} — ${primaryHook.pattern}
- Sudut Alternatif:
${secondaryHooks.map(h => `- ${h.name}: ${h.pattern}`).join('\n')}

PERATURAN PELBAGAIAN HOOK (ANTI-REPETITION & TIME-AGNOSTIC):
1. TULIS SEBAGAI PENASIHAT KEWANGAN SEBENAR: Suara empati, jujur, dan beretika. JANGAN guna nada scammer ("kelulusan 100% tanpa dokumen" - DILARANG).
2. JANGAN GUNA AYAT PEMBUKA KLISE ATAU BERULANG. Setiap post mesti membawakan sudut berbeza (analisa payslip, tips CCRIS, perbandingan interest, kelegaan overlap).
3. JANGAN mulakan dengan frasa bosan seperti "Korang tahu tak...", "Adakah anda mencari pinjaman...", "Tahu tak korang...".`;
        } else {
            hooksInstructions = `CRITICAL ORGANIC & DYNAMIC HOOK ENGINE (ZERO TEMPLATES & ZERO REPETITION):
1. IN MEDIAS RES (TERUS MASUK KE BABAK SITUASI):
   - Mula terus pada titik konflik, masalah harian, situasi terdesak, atau reaksi spontan terhadap masalah produk.
   - DILARANG guna ayat mukadimah atau salam formal di Slide 1.
   - Reka ayat pembuka yang 100% UNIK dan SPESIFIK untuk produk ini sahaja (bukan templat umum).
2. SENARAI HITAM PEMBUKA AYAT KLISE (STRICTLY BANNED OPENING PATTERNS):
   - DILARANG mulakan dengan: "Jangan buat silap macam aku dulu..."
   - DILARANG mulakan dengan: "Sumpah aku menyesal lambat tahu..."
   - DILARANG mulakan dengan: "Korang tahu tak..." / "Tahukah anda..." / "Tahu tak korang..."
   - DILARANG mulakan dengan: "Pernah tak korang..." / "Siapa kat sini yang..."
   - DILARANG mulakan dengan: "Aku nak buat pengakuan..." / "Pengakuan jujur..."
   - DILARANG mulakan dengan: "Ramai orang salah faham..." / "Satu benda yang aku baru belajar..."
   - DILARANG mulakan dengan: "Ada yang kata X, ada yang kata Y..."
3. KEPELBAGAIAN GAYA & PANJANG AYAT PEMBUKA:
   - Pelbagaikan gaya pembuka mengikut kesesuaian produk:
     * Gaya Fragmen Pendek (2-4 patah perkataan): Contoh: "Sakit hati betul.", "Stress gila.", "Benda paling leceh."
     * Gaya Situasi Spesifik: Masuk terus ke senario harian (contoh: "Bila tengah kalut nak keluar pagi...", "Setiap kali balik rumah tengok sinki...").
     * Gaya Monolog Spontan: Cerita candid peribadi (contoh: "Tiga hari aku peram kotak ni atas meja sebab...", "Dulu ingat benda macam ni gimik kedai...").
     * Gaya Kontras & Kelegaan: Perbezaan sebelum & selepas rasa (contoh: "Lega gila bila dah tak payah hadap...").
4. TIME-AGNOSTIC & EVERGREEN:
   - Elakkan kata masa sempit (contoh: "Tadi petang...", "Semalam pukul 3...") supaya post relevan bila-bila masa diterbitkan.`;
        }

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
1. ORGANIC HOOK GENERATION: Sila cipta ayat pembuka Slide 1 yang segar, spontan dan unik mengikut situasi produk di bawah. JANGAN tiru ayat pembuka dari contoh secara bulat-bulat, dan JANGAN gunakan templat klise AI.
2. JENIS HARTANAH WAJIB TEPAT: Baca maklumat di bawah dengan teliti. Kenalpasti jenis hartanah yang sebenar (contoh: shop lot, apartment, rumah teres, bungalow, SoHo, pejabat) dan gunakan istilah YANG SAMA dalam copywriting. JANGAN tukar jenis hartanah (contoh: jangan ubah "shop lot" kepada "unit" atau "apartment"). Kalau ia shop lot, tulis pasal shop lot/kedai. Kalau ia rumah, tulis pasal rumah.
3. Sekiranya maklumat di bawah adalah topik perbincangan, perkongsian tips, atau perbandingan umum (BUKAN listing spesifik bagi unit tertentu), JANGAN reka atau hallucinate butiran unit (seperti saiz sqft, bilangan bilik, status freehold/leasehold, fasiliti, atau harga). Sebaliknya, fokus sepenuhnya untuk membincangkan topik/tips tersebut menggunakan gaya bahasa dan tone dari contoh.
4. ${isPropertyContent ? 'HARTANAH MYSTERY RULE: JANGAN sebut nama projek, nama pemaju, atau alamat penuh unit di dalam teks Part 1 dan Part 2. Gunakan teaser lokasi am (contoh: "kawasan Puchong", "area Cyberjaya") untuk membina curiosity sebelum reveal di bahagian akhir.' : isPembiayaanContent ? 'PEMBIAYAAN ADVISORY RULE: Tulis sebagai Konsultan / Penasihat Pembiayaan yang sah & beretika. Gunakan istilah "skim pembiayaan ni", "pelan penyatuan hutang ni", "fasiliti koperasi ni". JANGAN gunakan istilah "benda ni" atau "gajet ni".' : 'PERATURAN MISTERI & CTR (CURIOSITY RULE): JANGAN sebut nama spesifik produk, nama jenama, atau model produk di dalam teks copywriting. Sebaliknya, gunakan nama am atau kata ganti misteri (seperti "benda ni", "gadget ni", "unit ni") untuk membina rasa ingin tahu (curiosity) pembaca.'}

${antiAiTropesPromptBlock}

${product}
`;
            
            let extraRules = "";
            if (nicheKey === 'hartanah' || isPropertyContent) {
                // Hartanah-specific engagement rules — replace ALL generic product rules
                if (tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
                    extraRules = `\n\nCRITICAL HARTANAH REALISTIC LOGIC & CONVERSION RULES (WAJIB IKUT):
1. MANDATORI PERSPEKTIF EJEN REN (STRICT REN ROLE MANDATE): Watak "Aku" dalam penulisan WAJIB 100% bertindak sebagai EJEN HARTANAH / REN yang sedang menguruskan, memeriksa (inspecting), atau memberi nasihat tentang unit tersebut kepada kawan/client. JANGAN SEKALI-KALI menulis dari perspektif penyewa atau pembeli (DILARANG menulis 'aku jimat 2 jam jem' atau 'aku tinggal kat sini'). Sebaliknya WAJIB gunakan gaya ejen: "banyak client mengadu kat aku penat jem...", "bila aku bawa client viewing...", atau "sebagai REN yang dah inspect unit ni...".
2. LOGIK KEWANGAN & NOMBOR (REALISTIC MATH RULE): Wajib gunakan angka & kiraan yang LOGIK mengikut pasaran Malaysia. Contoh: Rumah RM350k = komitmen bulanan ~RM1,500/bulan (memerlukan gaji bersih min RM3,500). JANGAN reka angka tak logik (contoh: JANGAN kata gaji RM2k boleh lulus loan RM500k).
3. ELAQKAN FORMULA & HOOK REPETITIVE AI: JANGAN guna ayat pembuka klise yang nampak macam AI bot (seperti "Dalam dunia hartanah...", "Adakah anda mencari...", "Benda paling pelik bila...").
4. CURIOSITY GAP UNTUK LISTING: Jangan reveal nama spesifik projek/pemaju atau harga penuh di Part 1 dan Part 2. Gunakan teaser kawasan/lokasi am (contoh: "kawasan Cheras Selatan", "area Sepang/Dengkil") untuk membina keinginan pembaca membaca hingga akhir.
5. DEKLARASI DETAILS HARTANAH BERPERINGKAT: Part 1 = Teaser hook & senario pembeli. Part 2-3 = Spesifikasi & kelebihan kawasan. Part akhir = Anggaran harga, kelayakan loan & CTA mesra.
6. CTA NATURAL & LOW-PRESSURE: Gunakan CTA santai tanpa paksaan (contoh: "Nak aku tolong semak kelayakan loan percuma? Drop 'INFO' kat komen", "WhatsApp aku kalau nak tengok video walkthrough unit ni").
7. Hashtag relevan letak di part terakhir sahaja.

[Hook Strategy - Hartanah]:
${hooksInstructions}`;
                }
            } else if (nicheKey === 'pembiayaan' || isPembiayaanContent) {
                extraRules = `\n\nCRITICAL PEMBIAYAAN PERIBADI & FINANCIAL ADVISOR RULES (WAJIB IKUT):
1. MANDATORI PERSPEKTIF KONSULTAN / ADVISOR KEWANGAN: Watak "Aku" / "Saya" WAJIB 100% bertindak sebagai Penasihat / Konsultan Pembiayaan Peribadi Bank & Koperasi yang berpengalaman, empati, dan telus. Anda BUKAN menjual barang e-commerce — DILARANG guna istilah "benda ni" atau "gajet ni". Gunakan istilah "skim pembiayaan ni", "pelan penyatuan hutang ni", "fasiliti koperasi ni", atau "servis semakan kelayakan".
2. SENTUH MASALAH SEBENAR (REAL DEBT PAIN POINTS): Buka dengan senario kehidupan sebenar (contoh: gaji RM4k-RM5k tapi lepas tolak 3 kad kredit & personal loan tinggal RM400 cashflow, potongan payslip kerajaan dah cecah 60%, nama sangkut CCRIS/CTOS sebab jadi penjamin, pening bayar interest tinggi).
3. MATEMATIK REALISTIK & PENYATUAN HUTANG (DEBT CONSOLIDATION): Tunjukkan kiraan realistik penjimatan cashflow bila satukan hutang (contoh: "Daripada bayar RM2,300 sebulan untuk 4 akaun pinjaman, satukan bawah 1 skim koperasi/bank dengan rate rendah — komitmen bulanan turun jadi RM1,100, jimat RM1,200 cashflow tunai setiap bulan").
4. FAHAMI SEGMEN GOV VS SWASTA:
   - Kakitangan Kerajaan / Badan Berkanun / GLC: Kelayakan potongan ANGKASA/Payslip 60%, fasiliti koperasi khas, overlap pinjaman lama, payout tinggi.
   - Sektor Swasta: Kelayakan DSR bank, rekod CCRIS/CTOS, penyatuan kad kredit & personal loan bank.
5. BERETIKA & BANGKITKAN KEPERCAYAAN (NO SCAM): DILARANG keras guna janji palsu (JANGAN tulis '100% lulus tanpa dokumen', 'duit masuk 1 jam', atau ayat macam Ah Long). Tekankan semakan kelayakan percuma, privasi data terjamin, dan proses 100% sah melalui institusi bank/koperasi.
6. CTA LOW-PRESSURE & KONSULTASI: Akhiri dengan ajakan santai untuk semak kelayakan (contoh: "Boleh DM atau WhatsApp kami slip gaji untuk kami tolong semak kelayakan & kira DSR secara PERCUMA.").

[Hook Strategy - Pembiayaan / Kewangan]:
${hooksInstructions}
`;
            } else if (nicheKey === 'affiliate' || tone?.toLowerCase().includes('malay') || language?.toLowerCase().includes('malay')) {
                extraRules = `\n\nCRITICAL HIGH-CONVERSION AFFILIATE & MALAYSIAN COPYWRITING RULES:
1. HIGH CONVERSION & SALES FOCUS (Bukan sekadar views): Jangan sekadar bina cerita kosong atau clickbait tanpa isi. Wajib berikan VALUE PROPOSITION dan SEBAB KUKUH kenapa pembaca patut beli/klik sekarang.
2. EMPATHY & REAL SCENARIO HOOK: Mulakan dengan situasi/masalah sebenar kehidupan harian pembaca tanpa guna templat klise.
3. PRACTICAL VALUE & RESULT: Terangkan secara spesifik BAGAIMANA produk menyelesaikan masalah tersebut (contoh: jimat 30 minit tiap pagi, jimat elektrik 40%, wayar tak bersepah, baju terus licin).
4. BUYING INTENT PRIMING & NATURAL SOCIAL PROOF INTEGRATION:
   - Tulis macam rekomendasi ikhlas dari kawan yang dah beli & pakai.
   - JIKA TERDAPAT DATA STATISTIK PRODUK (seperti Rating ⭐ 4.8-4.9, Jumlah Ulasan 1k+, atau Jumlah Terjual 3k-10k+ unit dalam maklumat di bawah), SELITKAN fakta ini secara santai & bersahaja dalam copywriting untuk melonjakkan keyakinan pembaca (Social Proof).
   - CONTOH CARA SELIT YANG SANGAT NATURAL (Bukan ayat robot korporat):
     * "Tengok review dah dekat 1.2k orang beli rating 4.9 baru aku yakin nak try..."
     * "Patutlah terjual sampai 3.5k unit, bila barang sampai memang solid..."
     * "Mula-mula ingat biasa je, sekali tengok feedback pembeli lain ramai puji benda ni memang function..."
     * "Kedai ni rating 4.9⭐ dengan ulasan beribu, seller pun pos laju gila..."
   - DILARANG tulis macam iklan korporat kaku (seperti: "Produk ini mempunyai 3500 unit terjual"). Wajib tulis sebagai reaksi kagum/puas hati seorang pembeli.
5. DYNAMIC LINK PLACEMENT: Link {{SHOPEE_LINK}} TIDAK TERHAD di slide/post terakhir sahaja. AI digalakkan meletakkan {{SHOPEE_LINK}} secara rawak & semula jadi di mana-mana bahagian thread mengikut konteks ayat — sama ada di Hook/Slide 1 (contoh: "sejak aku beli {{SHOPEE_LINK}} ni..."), di Slide Tengah (contoh: "bila aku pasang {{SHOPEE_LINK}} ni..."), atau di Slide Akhir/CTA (contoh: "nah link promo kalau nak ushar: {{SHOPEE_LINK}}"). Pelbagaikan kedudukannya secara dinamik bagi setiap posting.
6. STRICTLY PROHIBIT SPAMMY HARD-SELL: JANGAN guna frasa kasar seperti "Beli sekarang!", "Dapatkan segera!" atau "Klik link bio!".

[Organic Hook Strategy - Affiliate]:
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
7. BUYING INTENT PRIMING & NATURAL SOCIAL PROOF INTEGRATION: In your copywriting, build interest to purchase by casually mentioning verified buyer stats, seller ratings (⭐ 4.8/4.9), ulasan feedback, or high unit sales (e.g. "Korang check sendiri review kat kedai ni, rating 4.9⭐ beribu orang beli...", "Patutlah sampai 5k unit terjual, memang function gila...", "Nasib baik aku ushar feedback pembeli dulu, semua kata puas hati..."). Frame it as personal validation and genuine social proof, never as stiff corporate metrics.
8. AVOID GENERIC MARKETING & CLICKBAIT KOSONG: Do not use empty clickbait phrases like "Korang kena tahu ni" if there is no real value right after. Do not start with generic bot phrases like "Mari mulakan...".
9. HOOK DIVERSITY:
${hooksInstructions}
10. CURIOSITY & MYSTERY RULE (No Product/Brand/Project Names): NEVER mention the exact product name, brand name, model name (e.g. 'Machenike G3 V2') or specific project name directly in the copywriting text. Instead, refer to it using generic, curiosity-inducing terms (e.g., 'benda ni', 'gadget ni', 'kipas ni', 'apartment ni', 'unit ni', 'skim pembiayaan ni', 'pelan ni') to create mystery and drive clicks/engagement.
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

