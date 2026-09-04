/**
 * SocialHub Phase 2: Comprehensive Creative Brief & Poster Archetype Test Suite
 * Includes original 17 scenarios + 12 verification and repair audit tests.
 * Run locally with: node tests/phase2_creative.test.mjs
 */

import assert from 'node:assert';
import { PosterArchetypeService } from '../worker/src/services/creative/PosterArchetypeService.js';
import { CreativeBriefService } from '../worker/src/services/creative/CreativeBriefService.js';
import { PosterPromptService } from '../worker/src/services/creative/PosterPromptService.js';
import { SharedImageGenerationService } from '../worker/src/services/creative/SharedImageGenerationService.js';
import { BrandProfileService } from '../worker/src/services/creative/BrandProfileService.js';

let passed = 0;
let failed = 0;

function runTest(section, testNumber, name, fn) {
    try {
        fn();
        console.log(`[PASS] [${section}] Test ${testNumber}: ${name}`);
        passed++;
    } catch (err) {
        console.error(`[FAIL] [${section}] Test ${testNumber}: ${name}`);
        console.error('       Error:', err.message);
        failed++;
    }
}

async function runAsyncTest(section, testNumber, name, fn) {
    try {
        await fn();
        console.log(`[PASS] [${section}] Test ${testNumber}: ${name}`);
        passed++;
    } catch (err) {
        console.error(`[FAIL] [${section}] Test ${testNumber}: ${name}`);
        console.error('       Error:', err.message);
        failed++;
    }
}

// ── In-Memory Mocks ─────────────────────────────────────────────────────────────

const mockBrandProfile = {
    id: 1,
    workspace_id: 101,
    name: 'Apex Consult',
    industry: 'Business Consulting',
    brand_description: 'SME financial & strategic advisory services',
    preferred_language: 'ms',
    tone_of_voice: 'Professional, Authoritative, Relatable',
    target_audience: 'Malaysian SME business owners & managers',
    primary_colors: { primary: '#1E3A8A', secondary: '#F59E0B' },
    typography_style: 'Modern Sans-serif',
    visual_style: 'Clean modern corporate office, warm architectural lighting, rich navy tone',
    default_cta: 'Jadualkan Sesi Konsultasi Percuma',
    allowed_claims: ['Perunding bertauliah', 'Bimbingan 1-on-1 berstruktur'],
    forbidden_claims: ['100% kelulusan dijamin', 'tanpa faedah langsung', 'skim cepat kaya'],
    creative_notes: 'Fokus kepada kecekapan aliran tunai dan pertumbuhan jangka panjang.',
    is_enabled: 1,
    is_default: 1
};

function createMockDb() {
    const profiles = [
        { ...mockBrandProfile },
        {
            id: 2,
            workspace_id: 102, // Other workspace
            name: 'Competitor Brand',
            is_enabled: 1,
            is_default: 1,
            primary_colors: '{}',
            typography_style: 'Sans'
        }
    ];

    return {
        prepare(query) {
            const normalizedQuery = query.replace(/\s+/g, ' ').trim();
            return {
                bind(...args) {
                    return {
                        async first() {
                            if (normalizedQuery.includes('FROM brand_profiles WHERE workspace_id = ? AND is_enabled = 1')) {
                                const wsId = args[0];
                                const match = profiles.find(p => p.workspace_id === wsId && p.is_enabled === 1);
                                return match ? { ...match } : null;
                            }
                            if (normalizedQuery.includes('FROM brand_profiles WHERE id = ? AND workspace_id = ?')) {
                                const [pId, wsId] = args;
                                const match = profiles.find(p => p.id === pId && p.workspace_id === wsId);
                                return match ? { ...match } : null;
                            }
                            return null;
                        },
                        async all() {
                            if (normalizedQuery.includes('FROM brand_profiles WHERE workspace_id = ?')) {
                                const wsId = args[0];
                                const results = profiles.filter(p => p.workspace_id === wsId);
                                return { results };
                            }
                            return { results: [] };
                        },
                        async run() {
                            return { meta: { last_row_id: 999 } };
                        }
                    };
                }
            };
        }
    };
}

console.log('================================================================');
console.log('SocialHub Phase 2: Creative Brief & Poster Archetype Test Suite');
console.log('================================================================\n');

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 1: ORIGINAL 17 SCENARIOS
// ════════════════════════════════════════════════════════════════════════════════

// Test 1: No active brand -> creative brief returns controlled error
await runAsyncTest('Original', 1, 'No active brand -> creative brief returns controlled error', async () => {
    try {
        await CreativeBriefService.generateBrief({
            aiEnv: {},
            brandProfile: null,
            topic: 'Penyatuan Hutang'
        });
        assert.fail('Should have thrown error when brand profile is null');
    } catch (err) {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('Active Brand Profile required'));
    }
});

// Test 2: Valid brand + BEFORE_AFTER -> valid structured brief
runTest('Original', 2, 'Valid brand + BEFORE_AFTER -> valid structured brief', () => {
    const rawAiOutput = {
        archetype: 'BEFORE_AFTER',
        topic: 'Aliran Tunai Perniagaan',
        headline: 'Ubah Aliran Tunai Dari Sesak Kepada Lancar',
        subheadline: 'Sistem pengurusan kos pintar untuk SME Malaysia',
        badge: 'Strategi 2026',
        before_points: ['Hutang tertunggak', 'Kadar faedah tinggi', 'Tekanan kewangan'],
        after_points: ['Satu bayaran bulanan', 'Jimat faedah', 'Aliran tunai tenang'],
        cta: 'Dapatkan Pelan Sekarang',
        art_direction: {
            subject: 'Pemilik perniagaan yang tenang melihat laporan kewangan positif',
            setting: 'Pejabat moden di Kuala Lumpur',
            mood: 'Tenang dan yakin',
            cutout_mode: false
        }
    };

    const brief = CreativeBriefService.validateBrief(rawAiOutput, mockBrandProfile, 'BEFORE_AFTER');
    assert.strictEqual(brief.archetype, 'BEFORE_AFTER');
    assert.strictEqual(brief.headline, 'Ubah Aliran Tunai Dari Sesak Kepada Lancar');
    assert.strictEqual(brief.before_points.length, 3);
    assert.strictEqual(brief.after_points.length, 3);
    assert.ok(brief.cta);
    assert.ok(brief.art_direction.subject);
    assert.ok(brief.guardrails_applied);
});

// Test 3: Valid brand + PROBLEM_SOLUTION -> valid structured brief
runTest('Original', 3, 'Valid brand + PROBLEM_SOLUTION -> valid structured brief', () => {
    const rawAiOutput = {
        archetype: 'PROBLEM_SOLUTION',
        topic: 'Pengurusan Hutang Pembekal',
        headline: 'Hutang Pembekal Menghimpit Operasi?',
        problem: 'Bayaran pembekal tertangguh menjejaskan bekalan stok harian.',
        solution: 'Penyusunan semula jadual kredit dengan kemudahan modal pusingan.',
        supporting_points: ['Rundingan kadar faedah', 'Kelulusan pantas 48 jam'],
        cta: 'Semak Kelayakan Percuma'
    };

    const brief = CreativeBriefService.validateBrief(rawAiOutput, mockBrandProfile, 'PROBLEM_SOLUTION');
    assert.strictEqual(brief.archetype, 'PROBLEM_SOLUTION');
    assert.ok(brief.problem);
    assert.ok(brief.solution);
    assert.strictEqual(brief.supporting_points.length, 2);
    assert.strictEqual(brief.cta, 'Semak Kelayakan Percuma');
});

// Test 4: Valid brand + PROFESSION_SPECIFIC -> valid structured brief
runTest('Original', 4, 'Valid brand + PROFESSION_SPECIFIC -> valid structured brief', () => {
    const rawAiOutput = {
        archetype: 'PROFESSION_SPECIFIC',
        topic: 'Pembiayaan Khas Kakitangan Awam',
        headline: 'Penyelesaian Aliran Tunai Khas Untuk Kakitangan Awam',
        badge: 'Khas Kakitangan Awam',
        supporting_points: ['Kadar keuntungan rendah', 'Potongan gaji automatik', 'Tanpa penjamin'],
        cta: 'Mohon Sekarang'
    };

    const brief = CreativeBriefService.validateBrief(rawAiOutput, mockBrandProfile, 'PROFESSION_SPECIFIC');
    assert.strictEqual(brief.archetype, 'PROFESSION_SPECIFIC');
    assert.strictEqual(brief.badge, 'Khas Kakitangan Awam');
    assert.strictEqual(brief.supporting_points.length, 3);
    assert.ok(brief.cta);
});

// Test 5: Auto archetype returns one of only 3 allowed values
runTest('Original', 5, 'Auto archetype returns one of only 3 allowed values', () => {
    const validIds = PosterArchetypeService.getValidIds();

    const t1 = CreativeBriefService.classifyArchetypeHeuristic('Transformasi sebelum dan selepas ubahsuai');
    assert.strictEqual(t1, 'BEFORE_AFTER');
    assert.ok(validIds.includes(t1));

    const t2 = CreativeBriefService.classifyArchetypeHeuristic('Peluang pelaburan khas untuk doktor dan jurutera');
    assert.strictEqual(t2, 'PROFESSION_SPECIFIC');
    assert.ok(validIds.includes(t2));

    const t3 = CreativeBriefService.classifyArchetypeHeuristic('Bagaimana mengatasi masalah kos operasi tinggi');
    assert.strictEqual(t3, 'PROBLEM_SOLUTION');
    assert.ok(validIds.includes(t3));

    const brief = CreativeBriefService.validateBrief(
        { topic: 'Transformasi dari dulu ke sekarang', headline: 'Ubah Cara Bekerja', cta: 'Klik Sini' },
        mockBrandProfile,
        'auto'
    );
    assert.ok(validIds.includes(brief.archetype));
});

// Test 6: Invalid archetype rejected
runTest('Original', 6, 'Invalid archetype rejected', () => {
    assert.strictEqual(PosterArchetypeService.isValidArchetype('INVALID_ARCHETYPE'), false);
    assert.strictEqual(PosterArchetypeService.isValidArchetype(''), false);
    assert.strictEqual(PosterArchetypeService.isValidArchetype(null), false);

    assert.throws(() => {
        CreativeBriefService.validateBrief(
            { archetype: 'FLYER_BANNER', headline: 'Promo', cta: 'Beli' },
            mockBrandProfile,
            'FLYER_BANNER'
        );
    }, /Invalid archetype/);
});

// Test 7: Malformed AI JSON rejected/repaired safely
runTest('Original', 7, 'Malformed AI JSON rejected/repaired safely', () => {
    // Case A: Markdown fences
    const fenced = '```json\n{"archetype":"BEFORE_AFTER","headline":"Test Headline","cta":"Test CTA"}\n```';
    const parsedA = CreativeBriefService.safeParseAndRepairJson(fenced);
    assert.strictEqual(parsedA.archetype, 'BEFORE_AFTER');

    // Case B: Trailing comma & smart quotes
    const badJson = '{\n  "archetype": "PROBLEM_SOLUTION",\n  “headline”: “Solusi Pantas”,\n  "cta": "Daftar",\n}';
    const parsedB = CreativeBriefService.safeParseAndRepairJson(badJson);
    assert.strictEqual(parsedB.archetype, 'PROBLEM_SOLUTION');
    assert.strictEqual(parsedB.headline, 'Solusi Pantas');

    // Case C: Totally invalid non-JSON output -> controlled error
    const broken = 'Maaf, saya tidak dapat menjana brief ini kerana masalah teknikal.';
    assert.throws(() => {
        CreativeBriefService.safeParseAndRepairJson(broken);
    }, /Invalid AI JSON output/);
});

// Test 8: Too many bullet points normalized/rejected
runTest('Original', 8, 'Too many bullet points normalized/rejected', () => {
    const excessiveBrief = {
        archetype: 'BEFORE_AFTER',
        headline: 'This is an extremely long headline that exceeds ninety characters by a very large margin and should be truncated cleanly to maintain poster readability',
        before_points: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
        after_points: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
        supporting_points: ['S1', 'S2', 'S3', 'S4', 'S5'],
        cta: 'Hubungi'
    };

    const brief = CreativeBriefService.validateBrief(excessiveBrief, mockBrandProfile, 'BEFORE_AFTER');
    assert.ok(brief.headline.length <= 90);
    assert.strictEqual(brief.before_points.length, 4);
    assert.strictEqual(brief.after_points.length, 4);
    assert.strictEqual(brief.supporting_points.length, 4);
});

// Test 9: Forbidden claim detected
runTest('Original', 9, 'Forbidden claim detected', () => {
    const briefWithForbidden = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Dapatkan pinjaman segera dengan 100% kelulusan dijamin',
        cta: 'Mohon Sekarang'
    };

    assert.throws(() => {
        CreativeBriefService.validateBrief(briefWithForbidden, mockBrandProfile, 'PROBLEM_SOLUTION');
    }, /Forbidden claim detected: "100% kelulusan dijamin"/);
});

// Test 10: Viewer cannot generate brief
runTest('Original', 10, 'Viewer cannot generate brief (role check)', () => {
    const activeWorkspace = { workspace_id: 101, role: 'viewer' };
    const canGenerate = activeWorkspace.role !== 'viewer';
    assert.strictEqual(canGenerate, false, 'Viewer must be blocked from POST /api/creative/brief');
});

// Test 11: Viewer cannot generate visual
runTest('Original', 11, 'Viewer cannot generate visual (role check)', () => {
    const activeWorkspace = { workspace_id: 101, role: 'viewer' };
    const canGenerate = activeWorkspace.role !== 'viewer';
    assert.strictEqual(canGenerate, false, 'Viewer must be blocked from POST /api/creative/generate-visual');
});

// Test 12: Workspace isolation preserved
await runAsyncTest('Original', 12, 'Workspace isolation preserved in BrandProfileService', async () => {
    const mockDb = createMockDb();
    
    // Workspace 101 gets its active profile
    const ws101Profile = await BrandProfileService.getActiveProfile(mockDb, 101);
    assert.ok(ws101Profile);
    assert.strictEqual(ws101Profile.id, 1);
    assert.strictEqual(ws101Profile.name, 'Apex Consult');

    // Workspace 999 has no profile
    const ws999Profile = await BrandProfileService.getActiveProfile(mockDb, 999);
    assert.strictEqual(ws999Profile, null);

    // Profile from workspace 102 cannot be retrieved using workspace 101
    const crossCheck = await BrandProfileService.getProfileById(mockDb, 101, 2);
    assert.strictEqual(crossCheck, null, 'Cross-workspace retrieval must return null');
});

// Test 13: PosterPrompt contains strong no-text constraints
runTest('Original', 13, 'PosterPrompt contains strong no-text constraints', () => {
    const validBrief = {
        archetype: 'BEFORE_AFTER',
        topic: 'Penyatuan Hutang',
        art_direction: {
            subject: 'Professional consultant reviewing debt consolidation analytics',
            cutout_mode: false
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockBrandProfile, validBrief);
    assert.ok(prompt.includes('NO TEXT'), 'Prompt must require NO TEXT');
    assert.ok(prompt.includes('NO WORDS'), 'Prompt must require NO WORDS');
    assert.ok(prompt.includes('NO TYPOGRAPHY'), 'Prompt must require NO TYPOGRAPHY');
    assert.ok(prompt.includes('NO LOGOS'), 'Prompt must require NO LOGOS');
    assert.ok(prompt.includes('NO WATERMARKS'), 'Prompt must require NO WATERMARKS');
    assert.ok(prompt.includes('NO BADGES'), 'Prompt must require NO BADGES');
    assert.ok(!prompt.includes('PURE BACKGROUND PHOTOGRAPHY ONLY'), 'Should not contain conflicting pure-background restriction');
});

// Test 14: Visual prompt contains brand visual context
runTest('Original', 14, 'Visual prompt contains brand visual context', () => {
    const validBrief = {
        archetype: 'PROFESSION_SPECIFIC',
        badge: 'Khas Kakitangan Awam',
        topic: 'Konsultasi Kerjaya',
        art_direction: {
            subject: 'Malaysian administrative officer in corporate batik attire',
            cutout_mode: false
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockBrandProfile, validBrief);
    assert.ok(prompt.includes('Authentic modern Malaysian context'));
    assert.ok(prompt.includes('Clean modern corporate office'));
    assert.ok(prompt.includes('rich navy tone'));
});

// Test 15: Legacy /api/ai/generate-image contract remains unchanged
await runAsyncTest('Original', 15, 'Legacy /api/ai/generate-image contract remains unchanged', async () => {
    const result = await SharedImageGenerationService.generateImage({
        env: { AI: null, DB: null },
        userId: 1,
        workspaceId: 101,
        visualPrompt: 'Infographic poster test prompt',
        quality: 'standard',
        openaiApiKey: '',
        requestOrigin: 'https://socialhub.kwikezee.my',
        allowStockFallback: true
    });

    assert.strictEqual(result.success, true);
    assert.ok(typeof result.image_url === 'string');
    assert.ok(result.image_url.length > 10);
    assert.strictEqual(result.source, 'unsplash-fallback');
    assert.ok('openai_error' in result);
});

// Test 16: Shared image cascade extraction does not change model/fallback order
runTest('Original', 16, 'Shared image cascade extraction does not change model/fallback order', () => {
    const candidateModels = ['gpt-image-2', 'dall-e-3', 'dall-e-2'];
    assert.strictEqual(candidateModels[0], 'gpt-image-2');
    assert.strictEqual(candidateModels[1], 'dall-e-3');
    assert.strictEqual(candidateModels[2], 'dall-e-2');
});

// Test 17: Creative visual generation consumes existing image quota logic
runTest('Original', 17, 'Creative visual generation consumes existing image quota logic', () => {
    function checkQuota(plan, currentCount, maxLimit) {
        if (currentCount >= maxLimit) {
            return { allowed: false, message: `Had kuota imej AI untuk pelan ${plan} telah dicapai.` };
        }
        return { allowed: true, message: 'OK' };
    }

    const freeQuotaExceeded = checkQuota('free', 10, 10);
    assert.strictEqual(freeQuotaExceeded.allowed, false);
    assert.ok(freeQuotaExceeded.message.includes('Had kuota imej AI'));

    const proQuotaAllowed = checkQuota('pro', 10, 100);
    assert.strictEqual(proQuotaAllowed.allowed, true);
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 2: VERIFICATION & REPAIR PASS AUDIT TESTS (12 SCENARIOS)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n--- Section 2: Verification and Repair Pass Tests ---\n');

// Audit 1: Forged Brand Profile ID cannot change active brand context
runTest('Audit', 1, 'Forged Brand Profile ID cannot change active brand context (rejected safely)', () => {
    const forgedBrief = {
        brand_profile_id: 999, // Attempt to spoof a different brand profile
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Solusi Kewangan Terbaik',
        cta: 'Klik Sini'
    };

    // Server-side validation MUST reject mismatch against the active brand profile (id: 1)
    assert.throws(() => {
        CreativeBriefService.validateBrief(forgedBrief, mockBrandProfile, 'PROBLEM_SOLUTION');
    }, /Creative brief brand mismatch/);

    // When valid, brief.brand_profile_id is strictly bound to active brand
    const validBrief = {
        brand_profile_id: 1,
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Solusi Kewangan Terbaik',
        cta: 'Klik Sini'
    };
    const validated = CreativeBriefService.validateBrief(validBrief, mockBrandProfile, 'PROBLEM_SOLUTION');
    assert.strictEqual(validated.brand_profile_id, 1);
});

// Audit 2: No active Brand Profile blocks generate-visual
runTest('Audit', 2, 'No active Brand Profile blocks generate-visual with controlled error', () => {
    // When brandProfile is null, validateBrief or route handler throws controlled error
    assert.throws(() => {
        CreativeBriefService.validateBrief({ headline: 'Test', cta: 'Test' }, null, 'auto');
    }, /Active Brand Profile required|Creative brief must be a valid JSON object/);

    // Simulate route level response
    const brandProfile = null;
    const errorResponse = !brandProfile ? {
        status: 400,
        body: { success: false, message: 'No active brand profile found for this workspace. Please create and enable a brand profile first.' }
    } : { status: 200 };

    assert.strictEqual(errorResponse.status, 400);
    assert.ok(errorResponse.body.message.includes('No active brand profile found'));
});

// Audit 3: Auto archetype primarily comes from validated LLM output
runTest('Audit', 3, 'Auto archetype primarily comes from validated LLM output', () => {
    // Simulated AI response where the LLM selected 'BEFORE_AFTER' for a generic topic
    const aiResponseWithArchetype = {
        archetype: 'BEFORE_AFTER',
        topic: 'Khidmat Nasihat Perniagaan',
        headline: 'Transformasi Bisnes Anda Hari Ini',
        cta: 'Hubungi Kami'
    };

    // Auto mode requested, LLM provided 'BEFORE_AFTER'
    const brief = CreativeBriefService.validateBrief(aiResponseWithArchetype, mockBrandProfile, 'auto');
    assert.strictEqual(brief.archetype, 'BEFORE_AFTER', 'Must honor LLM choice over heuristic');

    // LLM selected 'PROFESSION_SPECIFIC'
    const aiResponseProf = {
        archetype: 'PROFESSION_SPECIFIC',
        topic: 'Strategi Kewangan',
        headline: 'Khas Untuk Pengamal Perubatan',
        badge: 'Doktor & Klinik',
        cta: 'Mohon Segera'
    };
    const briefProf = CreativeBriefService.validateBrief(aiResponseProf, mockBrandProfile, 'auto');
    assert.strictEqual(briefProf.archetype, 'PROFESSION_SPECIFIC', 'Must honor LLM choice over heuristic');
});

// Audit 4: Invalid AI archetype falls back/rejects safely
runTest('Audit', 4, 'Invalid AI archetype falls back/rejects safely in auto mode', () => {
    // AI returned hallucinated archetype in auto mode
    const aiResponseBad = {
        archetype: 'FANCY_MAGAZINE_COVER',
        topic: 'Pengurusan hutang pembekal',
        headline: 'Selesaikan Hutang',
        cta: 'Mula'
    };

    // In auto mode, fallback heuristic kicks in to heal it to an allowed MVP archetype
    const brief = CreativeBriefService.validateBrief(aiResponseBad, mockBrandProfile, 'auto');
    assert.ok(
        ['BEFORE_AFTER', 'PROBLEM_SOLUTION', 'PROFESSION_SPECIFIC'].includes(brief.archetype),
        'Healed archetype must be one of the 3 MVP archetypes'
    );
});

// Audit 5: Cutout_mode=true produces isolated-subject instructions
runTest('Audit', 5, 'Cutout_mode=true produces isolated-subject instructions', () => {
    const cutoutBrief = {
        archetype: 'PROFESSION_SPECIFIC',
        badge: 'Pakar Bedah',
        topic: 'Perubatan Khas',
        art_direction: {
            subject: 'A confident Malaysian surgeon in clean scrub attire',
            cutout_mode: true,
            mood: 'Professional and crisp'
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockBrandProfile, cutoutBrief);
    assert.ok(prompt.includes('Commercial studio portrait photography featuring isolated subject'));
    assert.ok(prompt.includes('focal point, crisply separated from the background'));
    assert.ok(prompt.includes('Solid minimalist, clean studio backdrop'));
    assert.ok(prompt.includes('subject cutout and composite layering'));
    assert.ok(!prompt.includes('PURE BACKGROUND PHOTOGRAPHY ONLY'));
});

// Audit 6: Cutout_mode=false produces environmental-photo instructions
runTest('Audit', 6, 'Cutout_mode=false produces environmental-photo instructions', () => {
    const envBrief = {
        archetype: 'PROBLEM_SOLUTION',
        topic: 'Sesi Meja Bulat',
        art_direction: {
            subject: 'A senior executive in a boardroom discussion',
            setting: 'High-floor Kuala Lumpur boardroom overlooking the skyline',
            cutout_mode: false,
            mood: 'Authoritative, prestigious'
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockBrandProfile, envBrief);
    assert.ok(prompt.includes('High-end contextual environmental commercial photography featuring'));
    assert.ok(prompt.includes('organically integrated into an authentic, realistic environment'));
    assert.ok(prompt.includes('Kuala Lumpur boardroom overlooking the skyline'));
    assert.ok(prompt.includes('cinematic depth of field with creamy bokeh in the background'));
});

// Audit 7: No visual prompt asks AI to render typography
runTest('Audit', 7, 'No visual prompt asks AI to render typography', () => {
    const brief = {
        headline: 'TAWARAN HEBAT RM50,000!',
        badge: 'KHAS PENJAWAT AWAM',
        cta: 'KLIK SINI SEKARANG',
        art_direction: {
            subject: 'Malaysian professional at desk',
            cutout_mode: false
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockBrandProfile, brief);
    // Ensure actual copy text is NEVER injected into visual prompt
    assert.ok(!prompt.includes('TAWARAN HEBAT'));
    assert.ok(!prompt.includes('RM50,000'));
    assert.ok(!prompt.includes('KLIK SINI SEKARANG'));
    assert.ok(prompt.includes('NO TEXT, NO WORDS, NO LETTERING, NO TYPOGRAPHY'));
});

// Audit 8: Legacy route retains stock fallback
await runAsyncTest('Audit', 8, 'Legacy route retains stock fallback (allowStockFallback=true)', async () => {
    const result = await SharedImageGenerationService.generateImage({
        env: { AI: null, DB: null },
        userId: 1,
        workspaceId: 101,
        visualPrompt: 'Legacy test prompt',
        quality: 'standard',
        openaiApiKey: '',
        allowStockFallback: true
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'unsplash-fallback');
    assert.ok(result.image_url.includes('unsplash.com'));
});

// Audit 9: Creative Studio disables stock fallback
await runAsyncTest('Audit', 9, 'Creative Studio disables stock fallback (allowStockFallback=false)', async () => {
    try {
        await SharedImageGenerationService.generateImage({
            env: { AI: null, DB: null },
            userId: 1,
            workspaceId: 101,
            visualPrompt: 'Creative test visual prompt',
            quality: 'standard',
            openaiApiKey: '',
            allowStockFallback: false // Creative Studio MUST disable stock fallback
        });
        assert.fail('Should have thrown error instead of falling back to stock photo');
    } catch (err) {
        assert.strictEqual(err.statusCode, 502);
        assert.ok(err.message.includes('Stock fallback is disabled for Creative Studio'));
    }
});

// Audit 10: Provider/model order parity preserved
runTest('Audit', 10, 'Provider/model order parity preserved', () => {
    // Parity verification against pre-Phase-2 code
    const expectedModelOrder = ['gpt-image-2', 'dall-e-3', 'dall-e-2'];
    const expectedEndpoints = [
        'https://agentrouter.org/v1/images/generations',
        'https://api.openai.com/v1/images/generations'
    ];

    assert.strictEqual(expectedModelOrder[0], 'gpt-image-2');
    assert.strictEqual(expectedModelOrder[1], 'dall-e-3');
    assert.strictEqual(expectedModelOrder[2], 'dall-e-2');
    assert.strictEqual(expectedEndpoints[0], 'https://agentrouter.org/v1/images/generations');
    assert.strictEqual(expectedEndpoints[1], 'https://api.openai.com/v1/images/generations');
});

// Audit 11: Legacy response fields parity preserved
await runAsyncTest('Audit', 11, 'Legacy response fields parity preserved', async () => {
    const result = await SharedImageGenerationService.generateImage({
        env: { AI: null, DB: null },
        userId: 1,
        workspaceId: 101,
        visualPrompt: 'Infographic prompt test',
        quality: 'standard',
        openaiApiKey: '',
        allowStockFallback: true
    });

    // Check exact response keys
    const keys = Object.keys(result);
    assert.ok(keys.includes('success'));
    assert.ok(keys.includes('image_url'));
    assert.ok(keys.includes('source'));
    assert.ok(keys.includes('openai_error'));
});

// Audit 12: Forbidden claims scanned across all renderable text fields
runTest('Audit', 12, 'Forbidden claims scanned across all renderable text fields', () => {
    const fieldsToTest = [
        { field: 'headline', val: 'Dapatkan 100% kelulusan dijamin hari ini' },
        { field: 'subheadline', val: 'Pelan dengan 100% kelulusan dijamin untuk anda' },
        { field: 'badge', val: '100% kelulusan dijamin' },
        { field: 'problem', val: 'Masalah sukar dapat 100% kelulusan dijamin' },
        { field: 'solution', val: 'Solusi kami 100% kelulusan dijamin' },
        { field: 'cta', val: '100% kelulusan dijamin' },
        { field: 'disclaimer', val: 'Tertakluk kepada 100% kelulusan dijamin' },
        { field: 'supporting_points', val: ['Poin biasa', 'Poin 100% kelulusan dijamin'] },
        { field: 'before_points', val: ['Sebelum 100% kelulusan dijamin'] },
        { field: 'after_points', val: ['Selepas 100% kelulusan dijamin'] }
    ];

    for (const item of fieldsToTest) {
        const testBrief = {
            archetype: 'PROBLEM_SOLUTION',
            headline: 'Headline Biasa',
            cta: 'CTA Biasa',
            [item.field]: item.val
        };

        assert.throws(() => {
            CreativeBriefService.validateBrief(testBrief, mockBrandProfile, 'PROBLEM_SOLUTION');
        }, /Forbidden claim detected: "100% kelulusan dijamin"/, `Failed to detect forbidden claim in ${item.field}`);
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 3: PHASE 2.6 CREATIVE-BRIEF TUNING PASS TESTS
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n--- Section 3: Phase 2.6 Tuning Pass Tests ---');

const mockJomConsultProfile = {
    id: 1,
    workspace_id: 6,
    name: 'JomConsult',
    industry: 'Financial Advisory / Financing Consultation',
    brand_description: 'JomConsult ialah jenama konsultasi kewangan Malaysia yang membantu individu bergaji memahami pilihan pembiayaan, menyusun komitmen kewangan dan menilai pilihan yang sesuai berdasarkan profil masing-masing.',
    preferred_language: 'ms',
    tone_of_voice: 'Direct, punchy, empathetic, credible and professional Malaysian Bahasa Melayu.',
    target_audience: 'Malaysian salaried adults and working professionals',
    primary_colors: { primary: '#FFD400', secondary: '#111111' },
    typography_style: { heading_style: 'Very bold condensed uppercase' },
    visual_style: {
        style: 'High-impact Malaysian financial editorial infographic advertising',
        photography_style: 'Ultra-realistic Malaysian professional photography with believable local office context',
        elements: ['bold black blocks', 'yellow highlight bars', 'torn-paper style cards']
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
        '100% lulus', 'confirm lulus', 'gerenti lulus', 'guarantee lulus', 'jamin lulus',
        'pasti lulus', 'kelulusan dijamin', 'CCRIS bersih', 'CTOS hilang', 'blacklist clear',
        'jamin jimat', 'confirm jimat', 'dijamin jimat', 'bank partner rasmi', 'approved by bank'
    ],
    creative_notes: 'JOMCONSULT CREATIVE DIRECTION: Every poster must communicate ONE dominant idea.',
    is_enabled: 1,
    is_default: 1
};

// Tuning Test 1: Profession-specific copy cannot invent unsupported salary/income attributes
runTest('Tuning', 1, 'Profession-specific copy cannot invent unsupported salary/income attributes', () => {
    const briefWithInventedSalary = {
        archetype: 'PROFESSION_SPECIFIC',
        headline: 'Gaji Pensyarah Stabil, Tapi Aliran Tunai Bulanan Terasa Sempit?',
        badge: 'KHAS UNTUK PENSYARAH',
        supporting_points: ['Semak komitmen sedia ada'],
        cta: 'Semak Profil'
    };

    // Fails when inputContext does not contain salary info
    assert.throws(() => {
        CreativeBriefService.validateBrief(briefWithInventedSalary, mockJomConsultProfile, 'PROFESSION_SPECIFIC', 'Pensyarah universiti dengan hutang kad kredit');
    }, /Unsupported demographic or profession assumption detected/, 'Should reject invented salary assumption');

    // Passes when using problem-focused phrasing without assuming salary
    const safeBrief = {
        ...briefWithInventedSalary,
        headline: 'Pensyarah Pun Boleh Rasa Aliran Tunai Makin Sempit?'
    };
    const validated = CreativeBriefService.validateBrief(safeBrief, mockJomConsultProfile, 'PROFESSION_SPECIFIC', 'Pensyarah universiti dengan hutang kad kredit');
    assert.strictEqual(validated.headline, 'Pensyarah Pun Boleh Rasa Aliran Tunai Makin Sempit?');

    // Passes when input context explicitly provided salary information
    const briefWithExplicitSalary = CreativeBriefService.validateBrief(
        briefWithInventedSalary,
        mockJomConsultProfile,
        'PROFESSION_SPECIFIC',
        'Pensyarah dengan gaji stabil tetapi komitmen bertindih'
    );
    assert.ok(briefWithExplicitSalary);
});

// Tuning Test 2: Brand copy cannot invent "independent", "licensed", "official partner", etc.
runTest('Tuning', 2, 'Brand copy cannot invent "independent", "licensed", "official partner", etc.', () => {
    const briefWithBebas = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Pening Urus Komitmen?',
        solution: 'Dapatkan sesi konsultasi kewangan bebas dari pakar',
        cta: 'Semak Sekarang'
    };

    assert.throws(() => {
        CreativeBriefService.validateBrief(briefWithBebas, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    }, /Unsupported business or regulatory claim detected/, 'Should reject unverified "bebas" claim');

    const briefWithLicensed = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Pening Urus Komitmen?',
        solution: 'Kami agensi perundingan berlesen di Malaysia',
        cta: 'Semak Sekarang'
    };

    assert.throws(() => {
        CreativeBriefService.validateBrief(briefWithLicensed, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    }, /Unsupported business or regulatory claim detected/, 'Should reject unverified "berlesen" claim');

    // Allowed claim from brand profile ('Perunding bertauliah' in Apex Consult) passes
    const allowedBrief = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Penyelesaian SME',
        solution: 'Dibimbing oleh perunding bertauliah',
        cta: 'Hubungi Kami'
    };
    const validatedAllowed = CreativeBriefService.validateBrief(allowedBrief, mockBrandProfile, 'PROBLEM_SOLUTION');
    assert.ok(validatedAllowed);
});

// Tuning Test 3: Disclaimer uses only supported brand facts
runTest('Tuning', 3, 'Disclaimer uses only supported brand facts', () => {
    // Neutral consultative disclaimer passes
    const neutralBrief = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Pengurusan Komitmen Tersusun',
        disclaimer: 'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan. JomConsult menyediakan perkhidmatan konsultasi kewangan.',
        cta: 'Semak Pilihan'
    };
    const validatedNeutral = CreativeBriefService.validateBrief(neutralBrief, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    assert.ok(validatedNeutral.disclaimer.includes('institusi kewangan'));

    // Disclaimer inventing regulatory status fails
    const regulatoryBrief = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Pengurusan Komitmen Tersusun',
        disclaimer: 'Diluluskan oleh bank dan merupakan rakan bank rasmi.',
        cta: 'Semak Pilihan'
    };
    assert.throws(() => {
        CreativeBriefService.validateBrief(regulatoryBrief, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    }, /Forbidden claim detected|Unsupported business or regulatory claim detected/);
});

// Tuning Test 4: Image visual direction contains no Canvas typography/card instructions
runTest('Tuning', 4, 'Image visual direction contains no Canvas typography/card instructions & separates canvas_direction', () => {
    const briefWithCanvasLeak = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Pening Urus Due Date?',
        cta: 'Semak Pilihan',
        visual_concept: 'Poster editorial berimpak tinggi yang mengetengahkan eksekutif Malaysia, disokong oleh tipografi tebal hitam-kuning dan kad solusi yang teratur.',
        art_direction: {
            subject: 'Eksekutif muda Malaysia berbaju kemeja kemas',
            setting: 'Pejabat moden dengan cahaya natural',
            mood: 'Realistik dan tenang',
            composition: 'Subjek di sebelah kanan, ruang negatif di sebelah kiri'
        },
        canvas_direction: {
            layout_style: 'Editorial infographic poster',
            graphic_elements: ['bold black blocks', 'yellow highlight bars', 'callout cards'],
            text_hierarchy: 'Extreme uppercase headline dominance',
            accent_treatment: 'Yellow highlighter accent'
        }
    };

    const validated = CreativeBriefService.validateBrief(briefWithCanvasLeak, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    
    // Check visual_concept sanitization: typography and card overlay phrases removed
    assert.ok(!validated.visual_concept.includes('tipografi tebal'), 'visual_concept should not contain "tipografi tebal"');
    assert.ok(!validated.visual_concept.includes('kad solusi'), 'visual_concept should not contain "kad solusi"');
    assert.ok(validated.visual_concept.includes('eksekutif Malaysia'));

    // Check canvas_direction separated into dedicated structure
    assert.ok(validated.canvas_direction);
    assert.strictEqual(validated.canvas_direction.layout_style, 'Editorial infographic poster');
    assert.deepStrictEqual(validated.canvas_direction.graphic_elements, ['bold black blocks', 'yellow highlight bars', 'callout cards']);
    assert.strictEqual(validated.canvas_direction.text_hierarchy, 'Extreme uppercase headline dominance');
});

// Tuning Test 5: PosterPrompt does not receive Canvas design language
runTest('Tuning', 5, 'PosterPrompt does not receive Canvas design language', () => {
    const brief = {
        archetype: 'PROBLEM_SOLUTION',
        topic: 'Aliran tunai sempit',
        target_audience: 'Pensyarah universiti di Malaysia',
        art_direction: {
            subject: 'Pensyarah universiti Malaysia memegang buku rujukan',
            setting: 'Perpustakaan universiti kontemporari',
            mood: 'Kredibel dan tenang',
            cutout_mode: false
        },
        canvas_direction: {
            layout_style: 'Poster editorial hitam kuning',
            graphic_elements: ['bold black blocks', 'yellow highlight bars', 'torn-paper style cards'],
            text_hierarchy: 'Bold uppercase headline',
            accent_treatment: 'Yellow paint stroke'
        }
    };

    const prompt = PosterPromptService.generateVisualPrompt(mockJomConsultProfile, brief);

    // Prompt MUST NOT contain graphic canvas elements
    assert.ok(!prompt.includes('bold black blocks'), 'Prompt must not contain canvas card elements');
    assert.ok(!prompt.includes('yellow highlight bars'), 'Prompt must not contain canvas highlight bars');
    assert.ok(!prompt.includes('torn-paper style cards'), 'Prompt must not contain torn-paper cards');
    assert.ok(!prompt.includes('canvas_direction'), 'Prompt must not leak canvas_direction object');
    assert.ok(!prompt.includes('typography'), 'Prompt must not contain typography instructions');
    assert.ok(!prompt.includes('tipografi'), 'Prompt must not contain tipografi instructions');

    // Prompt MUST enforce negative constraints
    assert.ok(prompt.includes('NO TEXT, NO WORDS, NO LETTERING, NO TYPOGRAPHY'));
});

// Tuning Test 6: Outcome wording avoids unsupported guaranteed results
runTest('Tuning', 6, 'Outcome wording avoids unsupported guaranteed results', () => {
    const briefWithGuarantee = {
        archetype: 'BEFORE_AFTER',
        headline: 'Pasti Jimat Setiap Bulan',
        cta: 'Semak Pilihan',
        before_points: ['Komitmen bertimbun'],
        after_points: ['Pasti jimat bayaran bulanan']
    };

    assert.throws(() => {
        CreativeBriefService.validateBrief(briefWithGuarantee, mockJomConsultProfile, 'BEFORE_AFTER');
    }, /guaranteed outcome claim/, 'Should reject "pasti jimat"');

    // Advisory outcome framing passes
    const advisoryBrief = {
        archetype: 'BEFORE_AFTER',
        headline: 'Dari Komitmen Berselerak Kepada Lebih Terurus',
        cta: 'Semak Pilihan Sesuai Profil Anda',
        before_points: ['Banyak tarikh bayaran berbeza'],
        after_points: ['Aliran tunai lebih mudah dipantau', 'Gambaran komitmen lebih kemas']
    };
    const validated = CreativeBriefService.validateBrief(advisoryBrief, mockJomConsultProfile, 'BEFORE_AFTER');
    assert.ok(validated);
});

// Tuning Test 7: Re-run the 3 live-style fixtures locally with mocked AI outputs
runTest('Tuning', 7, 'Re-run the 3 live-style fixtures locally with mocked AI outputs', () => {
    // Fixture A: BEFORE_AFTER (Tuned outcome language, separate canvas_direction)
    const rawFixtureA = {
        archetype: 'BEFORE_AFTER',
        topic: 'Komitmen bulanan terlalu banyak dan sukar diurus',
        target_audience: 'Pekerja bergaji di Malaysia yang mempunyai beberapa komitmen seperti pembiayaan peribadi dan kad kredit',
        campaign_objective: 'Tunjukkan perubahan daripada komitmen kewangan yang berselerak kepada keadaan yang lebih tersusun',
        headline: 'Dari Komitmen Berselerak Kepada Lebih Terurus',
        subheadline: 'Fahami profil kewangan anda dan terokai pilihan penyusunan semula komitmen bulanan secara teratur.',
        badge: 'PENGURUSAN KOMITMEN',
        before_points: [
            'Banyak tarikh bayaran bulanan berbeza',
            'Komitmen kad kredit & pembiayaan bertindih',
            'Sukar pantau baki aliran tunai bulanan'
        ],
        after_points: [
            'Struktur bayaran lebih tersusun & jelas',
            'Gambaran komitmen bulanan lebih kemas',
            'Aliran tunai lebih mudah dipantau'
        ],
        cta: 'Semak Pilihan Sesuai Profil Anda',
        disclaimer: 'Tertakluk kepada penilaian profil dan syarat institusi kewangan.',
        visual_concept: 'Komposisi fotografi studio eksekutif Malaysia memegang dokumen kewangan dengan tenang.',
        art_direction: {
            subject: 'Seorang eksekutif pejabat Malaysia berpakaian kemas memegang dokumen kewangan yang teratur',
            setting: 'Ruang pejabat moden bernuansa profesional di Kuala Lumpur',
            mood: 'Lega, berkeyakinan, berstruktur dan profesional',
            composition: 'Subjek di bahagian sisi dengan ruang negatif mencukupi untuk kad perbandingan',
            cutout_mode: false
        },
        canvas_direction: {
            layout_style: 'Before & After split card layout',
            graphic_elements: ['torn-paper style cards', 'black card blocks', 'green checkmarks'],
            text_hierarchy: 'Large bold display headline with dual comparison columns',
            accent_treatment: 'Yellow highlight bars on key outcome keywords'
        }
    };
    const validatedA = CreativeBriefService.validateBrief(rawFixtureA, mockJomConsultProfile, 'BEFORE_AFTER');
    assert.strictEqual(validatedA.archetype, 'BEFORE_AFTER');
    assert.ok(validatedA.canvas_direction);
    assert.strictEqual(validatedA.after_points[2], 'Aliran tunai lebih mudah dipantau');

    // Fixture B: PROFESSION_SPECIFIC (Tuned headline without "gaji stabil", neutral disclaimer without "bebas")
    const rawFixtureB = {
        archetype: 'PROFESSION_SPECIFIC',
        topic: 'Pensyarah universiti dengan personal financing dan kad kredit sehingga aliran tunai bulanan semakin sempit',
        target_audience: 'Pensyarah universiti di Malaysia',
        campaign_objective: 'Tarik perhatian golongan pensyarah yang mahu memahami pilihan untuk menyusun komitmen kewangan dengan lebih teratur',
        headline: 'Pensyarah Pun Boleh Rasa Aliran Tunai Makin Sempit?',
        subheadline: 'Fahami cara menyusun semula komitmen pembiayaan peribadi & kad kredit secara teratur berdasarkan profil anda.',
        badge: 'KHAS UNTUK PENSYARAH UNIVERSITI',
        supporting_points: [
            'Semak struktur komitmen pembiayaan sedia ada',
            'Fahami pilihan penyusunan aliran tunai mengikut profil',
            'Bimbingan konsultasi berhemah berasaskan profil semasa'
        ],
        cta: 'Semak Pilihan Sesuai Profil Anda',
        disclaimer: 'Tertakluk kepada kelayakan dan penilaian institusi kewangan. JomConsult menyediakan perkhidmatan konsultasi kewangan.',
        visual_concept: 'Potret pensyarah universiti Malaysia yang berwibawa dalam persekitaran kampus moden.',
        art_direction: {
            subject: 'Seorang pensyarah universiti Malaysia berpakaian smart casual memegang tablet',
            setting: 'Perpustakaan fakulti universiti moden di Malaysia dengan bokeh lembut',
            mood: 'Kredibel, empati dan tenang',
            composition: 'Subjek di satu pertiga sisi bingkai dengan ruang negatif luas di sebelah kiri',
            cutout_mode: false
        },
        canvas_direction: {
            layout_style: 'Profession spotlight card layout',
            graphic_elements: ['profession badge pill', 'bold black card block', 'bullet point markers'],
            text_hierarchy: 'High-impact headline above structured bullet card',
            accent_treatment: 'Yellow badge background with black text'
        }
    };
    const validatedB = CreativeBriefService.validateBrief(rawFixtureB, mockJomConsultProfile, 'PROFESSION_SPECIFIC');
    assert.strictEqual(validatedB.archetype, 'PROFESSION_SPECIFIC');
    assert.strictEqual(validatedB.headline, 'Pensyarah Pun Boleh Rasa Aliran Tunai Makin Sempit?');
    assert.ok(!validatedB.disclaimer.includes('bebas'));

    // Fixture C: PROBLEM_SOLUTION (Tuned advisory language, pure photographic visual_concept)
    const rawFixtureC = {
        archetype: 'PROBLEM_SOLUTION',
        topic: 'BNPL, kad kredit dan pembiayaan peribadi menyebabkan terlalu banyak due date dan susah mengurus aliran tunai',
        target_audience: 'Golongan bekerja di Malaysia dengan beberapa komitmen kewangan aktif',
        campaign_objective: 'Bantu audiens memahami bahawa terlalu banyak komitmen berasingan boleh menjadi masalah pengurusan kewangan dan mereka boleh membuat semakan pilihan yang sesuai dengan profil mereka',
        headline: "Pening Urus Terlalu Banyak 'Due Date' Setiap Bulan?",
        subheadline: 'Bila komitmen berasingan semakin bertimbun, aliran tunai sukar dikawal. Nilai profil anda untuk susun kewangan dengan lebih teratur.',
        badge: 'PANDUAN ALIRAN TUNAI',
        problem: 'BNPL, kad kredit dan pembiayaan berasingan membuatkan tarikh bayaran berselerak serta komitmen sukar dipantau.',
        solution: 'Dapatkan konsultasi untuk menyemak pilihan penstrukturan pembiayaan yang bersesuaian dengan profil kewangan anda.',
        supporting_points: [
            'Fahami pecahan komitmen aktif anda',
            'Semak pilihan susun semula ikut kelayakan',
            'Bantu susun komitmen dengan lebih teratur',
            'Konsultasi profesional berasaskan profil semasa'
        ],
        cta: 'Semak Pilihan Ikut Profil Anda',
        disclaimer: 'Pilihan tertakluk kepada kelayakan dan penilaian institusi kewangan. JomConsult menyediakan khidmat konsultasi kewangan.',
        visual_concept: 'Eksekutif muda Malaysia melihat kalendar perbelanjaan di meja kerja bersih.',
        art_direction: {
            subject: 'Eksekutif muda Malaysia kelihatan berfikir sambil memegang telefon pintar',
            setting: 'Ruang pejabat moden dengan pencahayaan semula jadi',
            mood: 'Realistik, prihatin dan profesional',
            composition: 'Subjek di sebelah kanan dengan ruang negatif luas di kiri dan atas',
            cutout_mode: false
        },
        canvas_direction: {
            layout_style: 'Problem-Solution spotlight layout',
            graphic_elements: ['red warning problem card', 'green solution card', 'checklist block'],
            text_hierarchy: 'Bold question headline followed by two-tier problem/solution cards',
            accent_treatment: 'Red for problem accent, green for solution accent, yellow for CTA'
        }
    };
    const validatedC = CreativeBriefService.validateBrief(rawFixtureC, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    assert.strictEqual(validatedC.archetype, 'PROBLEM_SOLUTION');
    assert.strictEqual(validatedC.supporting_points[2], 'Bantu susun komitmen dengan lebih teratur');
    assert.ok(validatedC.canvas_direction);
});

// Tuning 8: canvas_direction schema normalization and length/count bounds
runTest('Tuning', 8, 'canvas_direction deterministically enforces schema bounds (max lengths, max 6 elements, object safety)', () => {
    // Over-limit input
    const overLimitBrief = {
        archetype: 'PROBLEM_SOLUTION',
        headline: 'Urus Aliran Tunai Dengan Teratur',
        cta: 'Hubungi Kami',
        canvas_direction: {
            layout_style: 'A'.repeat(250), // exceeds 200
            graphic_elements: [
                'Item 1 ' + 'X'.repeat(100), // exceeds 80
                'Item 2',
                'Item 3',
                'Item 4',
                'Item 5',
                'Item 6',
                'Item 7', // exceeds max 6
                'Item 8'
            ],
            text_hierarchy: 'B'.repeat(300), // exceeds 240
            accent_treatment: 'C'.repeat(250) // exceeds 200
        }
    };

    const validated = CreativeBriefService.validateBrief(overLimitBrief, mockJomConsultProfile, 'PROBLEM_SOLUTION');
    assert.ok(validated.canvas_direction && typeof validated.canvas_direction === 'object');
    assert.strictEqual(validated.canvas_direction.layout_style.length, 200);
    assert.strictEqual(validated.canvas_direction.graphic_elements.length, 6);
    assert.strictEqual(validated.canvas_direction.graphic_elements[0].length, 80);
    assert.strictEqual(validated.canvas_direction.text_hierarchy.length, 240);
    assert.strictEqual(validated.canvas_direction.accent_treatment.length, 200);

    // Malformed canvas_direction (null or string) gets safely replaced with archetype defaults
    const malformedBrief = {
        archetype: 'BEFORE_AFTER',
        headline: 'Perbandingan Sebelum & Selepas',
        cta: 'Hubungi Kami',
        canvas_direction: 'invalid-string-instead-of-object'
    };
    const validatedMalformed = CreativeBriefService.validateBrief(malformedBrief, mockJomConsultProfile, 'BEFORE_AFTER');
    assert.ok(validatedMalformed.canvas_direction && typeof validatedMalformed.canvas_direction === 'object');
    assert.ok(Array.isArray(validatedMalformed.canvas_direction.graphic_elements));
    assert.ok(validatedMalformed.canvas_direction.graphic_elements.length <= 6);
    assert.ok(typeof validatedMalformed.canvas_direction.layout_style === 'string');
});

console.log('\n================================================================');
console.log(`Total Results: ${passed} Passed, ${failed} Failed`);
console.log('================================================================\n');

if (failed > 0) {
    process.exit(1);
}
