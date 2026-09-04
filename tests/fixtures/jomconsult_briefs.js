/**
 * jomconsult_briefs.js
 * Authoritative production fixture matching Phase 2.5 D1 Brand Profile record
 * and live Phase 2.6 Creative Briefs for deterministic testing and PNG rendering.
 */

export const mockJomConsultBrand = {
    id: 1,
    workspace_id: 6,
    name: 'JomConsult',
    website: 'https://www.jomconsult.com.my',
    industry: 'Financial Advisory / Financing Consultation',
    brand_description: 'JomConsult ialah jenama konsultasi kewangan Malaysia yang membantu individu bergaji memahami pilihan pembiayaan, menyusun komitmen kewangan dan menilai pilihan yang sesuai berdasarkan profil masing-masing. Komunikasi mesti bersifat konsultatif, jelas dan berasas, bukan menjanjikan kelulusan atau hasil tertentu.',
    preferred_language: 'ms',
    tone_of_voice: 'Direct, punchy, empathetic, credible and professional Malaysian Bahasa Melayu. Conversational and easy to understand, but never exaggerated, scammy, desperate, overly salesy or misleading.',
    target_audience: 'Malaysian salaried adults and working professionals including private sector, MNC, GLC, educators, lecturers, engineers, accountants and other professionals who may have multiple financial commitments such as personal financing, credit cards or BNPL and want to understand more structured financial options.',
    primary_colors: {
        primary: '#FFD400',
        secondary: '#111111',
        background: '#FFFFFF',
        surface: '#111111',
        text_primary: '#111111',
        text_inverse: '#FFFFFF',
        warning: '#E53935',
        positive: '#169B62'
    },
    typography_style: {
        heading_style: 'Very bold condensed uppercase display typography',
        heading_weight: '900',
        body_style: 'Clean highly-readable modern sans-serif',
        accent_style: 'Handwritten marker or brush accent used sparingly',
        hierarchy: 'Extreme headline dominance with clear supporting information hierarchy',
        usage_notes: 'Headline must remain readable on mobile feed. Avoid long paragraphs inside posters.'
    },
    visual_style: {
        style: 'High-impact Malaysian financial editorial infographic advertising',
        visual_density: 'High information density but highly organized and mobile-readable',
        photography_style: 'Ultra-realistic Malaysian professional photography with believable local office, workplace or financial-life context. Expressions should feel authentic and credible, not cheesy stock-photo acting.',
        composition: 'One dominant visual idea per poster. Strong headline hierarchy, asymmetric layouts, large subject cutouts or contextual photography with intentional negative space for typography.',
        elements: ['bold black blocks', 'yellow highlight bars', 'rough brush strokes', 'torn-paper style cards', 'editorial callout cards', 'large number emphasis', 'comparison blocks', 'check and cross indicators', 'arrows and process flow', 'financial document props', 'calculator or workplace props', 'subtle dot or grid textures'],
        warning_treatment: 'Use red selectively for risk, warning or negative-state communication',
        positive_treatment: 'Use green selectively for positive, improved or organized-state communication'
    },
    default_cta: 'Semak pilihan yang sesuai dengan profil anda',
    allowed_claims: [
        'Semakan kelayakan berdasarkan profil',
        'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan',
        'Konsultasi untuk memahami pilihan pembiayaan',
        'Bantu menyusun komitmen kewangan dengan lebih teratur',
        'Pilihan bergantung kepada profil dan komitmen semasa'
    ],
    forbidden_claims: [
        '100% lulus',
        'confirm lulus',
        'gerenti lulus',
        'guarantee lulus',
        'jamin lulus',
        'pasti lulus',
        'kelulusan dijamin',
        'CCRIS bersih',
        'bersihkan CCRIS',
        'padam CCRIS',
        'clear CCRIS',
        'CTOS hilang',
        'padam CTOS',
        'clear CTOS',
        'hapus CTOS',
        'blacklist clear',
        'clear blacklist',
        'buang blacklist',
        'hapus blacklist',
        'jamin jimat',
        'confirm jimat',
        'dijamin jimat',
        'bank partner rasmi',
        'approved by bank',
        'kelulusan tanpa semakan'
    ],
    is_enabled: 1,
    is_default: 1
};

export const briefTestA = {
    brand_profile_id: 1,
    archetype: 'BEFORE_AFTER',
    campaign_objective: 'Tunjukkan perubahan daripada komitmen kewangan yang berselerak kepada keadaan yang lebih tersusun',
    topic: 'Komitmen bulanan terlalu banyak dan sukar diurus',
    target_audience: 'Pekerja bergaji di Malaysia yang mempunyai beberapa komitmen seperti pembiayaan peribadi dan kad kredit',
    headline: 'Banyak Sangat Komitmen Bulanan Sampai Sukar Diurus?',
    subheadline: 'Fahami pilihan pembiayaan untuk menyusun komitmen kewangan anda agar lebih teratur dan jelas dipantau.',
    badge: 'STRUKTUR KOMITMEN',
    problem: null,
    solution: null,
    supporting_points: [],
    before_points: [
        'Tarikh bayaran berterabur & sukar dipantau',
        'Banyak komitmen kecil bertindan',
        'Aliran tunai bulanan rasa sempit'
    ],
    after_points: [
        'Jadual bayaran lebih teratur & kemas',
        'Pilihan dinilai mengikut profil semasa',
        'Gambaran kewangan lebih jelas dipantau'
    ],
    cta: 'Semak pilihan yang sesuai dengan profil anda',
    disclaimer: 'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan.',
    visual_concept: 'Seorang pekerja pejabat Malaysia lelaki berumur awal 30-an sedang duduk di meja kerja dengan ekspresi tenang dan fokus, memegang pen sambil melihat lembaran dokumen kewangan dalam suasana pejabat moden dengan pencahayaan semulajadi yang terang.',
    art_direction: {
        subject: 'Lelaki profesional Malaysia berusia awal 30-an berpakaian kemeja pejabat kemas dan berwajah tenang.',
        setting: 'Ruang pejabat moden yang kemas dan bersih dengan pencahayaan studio semulajadi dari sisi.',
        mood: 'Fokus, tenang, profesional, dan berorientasikan penyelesaian.',
        composition: 'Medium shot berposisi di bahagian kanan bingkai, membiarkan ruang negatif bersih yang luas di bahagian atas dan kiri.',
        cutout_mode: false
    },
    canvas_direction: {
        layout_style: 'Susun atur editorial perbandingan dua kad (Before vs After) dengan kontras visual yang kukuh.',
        graphic_elements: [
            'Kad latar gelap beraksen merah untuk keadaan Sebelum',
            'Kad berlatar cerah beraksen hijau/kuning untuk keadaan Selepas',
            'Garis penanda kuning gaya marker pada kata kunci headline',
            'Ikon anak panah transformasi mendatar'
        ],
        text_hierarchy: 'Headline ultra-tebal di bahagian atas, diikuti kad perbandingan dua kolum yang padat dan jelas, diakhiri dengan butang CTA berkontras tinggi di bahagian bawah.',
        accent_treatment: 'Palet teras hitam, putih, dan kuning JomConsult dengan aksen merah dan hijau fungsi status.'
    }
};

export const briefTestB = {
    brand_profile_id: 1,
    archetype: 'PROFESSION_SPECIFIC',
    campaign_objective: 'Tarik perhatian golongan pensyarah yang mahu memahami pilihan untuk menyusun komitmen kewangan dengan lebih teratur',
    topic: 'Pensyarah universiti dengan personal financing dan kad kredit sehingga aliran tunai bulanan semakin sempit',
    target_audience: 'Pensyarah universiti di Malaysia',
    headline: 'Komitmen Bertindan Buat Aliran Tunai Terasa Sempit?',
    subheadline: 'Fahami kaedah menilai semula pembiayaan peribadi dan kad kredit agar komitmen bulanan lebih teratur.',
    badge: 'Khas Untuk Pensyarah Universiti',
    problem: null,
    solution: null,
    supporting_points: [
        'Semak struktur pembiayaan peribadi & kad kredit semasa',
        'Bantu susun komitmen bulanan agar lebih kemas',
        'Nilai pilihan pembiayaan yang sesuai mengikut profil',
        'Konsultasi profesional berasaskan kelayakan semasa'
    ],
    before_points: [],
    after_points: [],
    cta: 'Semak Pilihan Sesuai Profil Anda',
    disclaimer: 'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan. Tiada jaminan kelulusan pembiayaan.',
    visual_concept: 'A realistic modern Malaysian university lecturer in smart-casual academic attire standing thoughtfully in a bright faculty lounge or university library, holding a tablet or notebook, with soft natural lighting and ample negative space on one side.',
    art_direction: {
        subject: 'Seorang pensyarah universiti Malaysia berpakaian kemeja kemas atau blazer kasual, berwajah matang dan bertafakur secara profesional',
        setting: 'Pejabat akademik atau ruang perpustakaan universiti moden dengan pencahayaan cahaya siang lembut',
        mood: 'Kredibel, intelektual, tenang dan mencerminkan realiti profesional',
        composition: 'Medium shot subjek di sebelah kanan komposisi dengan ruang negatif yang lapang dan bersih di sebelah kiri',
        cutout_mode: false
    },
    canvas_direction: {
        layout_style: 'Editorial financial guide poster with high-contrast color blocks and structured visual cards',
        graphic_elements: [
            'Kad blok hitam berimpak tinggi',
            'Penanda serlah warna kuning (yellow highlight accents)',
            'Lencana kategori profesional di bahagian atas'
        ],
        text_hierarchy: 'Tajuk utama besar dan berani di bahagian atas-kiri, diikuti kad senarai poin yang kemas dan butang CTA berimpak di bahagian bawah',
        accent_treatment: 'Palet dominan kuning, hitam dan putih dengan aksen kuning terang pada kata kunci dan butang tindakan'
    }
};

export const briefTestC = {
    brand_profile_id: 1,
    archetype: 'PROBLEM_SOLUTION',
    campaign_objective: 'Membantu audiens menyedari bahawa komitmen bertabur merumitkan aliran tunai dan memberi kesedaran untuk menyemak pilihan penstrukturan yang sesuai.',
    topic: 'Pengurusan pelbagai komitmen kewangan (BNPL, kad kredit dan pembiayaan peribadi)',
    target_audience: 'Golongan bekerja di Malaysia dengan beberapa komitmen kewangan aktif',
    headline: 'Banyak Sangat Due Date Sampai Aliran Tunai Berselerak?',
    subheadline: 'Kombinasi BNPL, kad kredit dan pembiayaan berasingan boleh dinilai semula untuk pengurusan yang lebih teratur.',
    badge: 'PANDUAN KOMITMEN',
    problem: 'Banyak tarikh bayaran berbeza setiap bulan menyukarkan pemantauan baki tunai sebenar.',
    solution: 'Bantu nilai dan susun komitmen kewangan mengikut kesesuaian profil semasa anda.',
    supporting_points: [
        'Fahami pecahan komitmen aktif dengan jelas',
        'Teroka pilihan penyelarasan mengikut kelayakan',
        'Bantu jadual bayaran bulanan lebih mudah dipantau'
    ],
    before_points: [],
    after_points: [],
    cta: 'Semak Pilihan Sesuai Profil Anda',
    disclaimer: 'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan. JomConsult menyediakan konsultasi pengurusan pembiayaan.',
    visual_concept: 'Seorang pekerja pejabat Malaysia sedang duduk di meja kerja moden, merenung buku nota dan komputer riba dengan ekspresi berfikir untuk menyusun jadual komitmen peribadi.',
    art_direction: {
        subject: 'Individu profesional Malaysia berpakaian kemas kasual perniagaan duduk di meja kerja dengan ekspresi berfikir yang tenang',
        setting: 'Ruang pejabat moden dengan pencahayaan lembut semula jadi, latar belakang kabur kemas',
        mood: 'Reflektif, profesional, tenang dan berwibawa',
        composition: 'Medium shot dengan subjek berada di sebelah kanan bingkai, membiarkan ruang negatif bersih yang luas di sebelah kiri',
        cutout_mode: false
    },
    canvas_direction: {
        layout_style: 'Problem-Solution structured editorial poster with clear vertical separation',
        graphic_elements: [
            'Kad blok hitam berimpak tinggi',
            'Garis penyerlah kuning gaya marker',
            'Ikon senarai semak minimalis'
        ],
        text_hierarchy: 'Headline utama mendominasi bahagian atas dengan kontras kuning-putih, diikuti blok masalah dan penyelesaian yang tersusun, diakhiri dengan butang CTA yang jelas',
        accent_treatment: 'Warna kuning jenama sebagai penekanan frasa utama dan kad hitam legap untuk kebolehbacaan maksimum di telefon pintar'
    }
};
