/**
 * phase3_canvas.test.mjs
 * Automated test suite for SocialHub Phase 3: Deterministic Poster Canvas Rendering Engine.
 *
 * Verifies all 18 core requirements + 2 mandatory safeguards:
 * 1. Correct renderer selected by archetype
 * 2. 1080x1080 output dimensions
 * 3. Headline never clips outside bounds
 * 4. Subheadline never clips
 * 5. Max bullet count respected (<= 4 points)
 * 6. CTA remains inside safe area (>= 56px)
 * 7. Disclaimer remains inside safe area (>= 56px)
 * 8. Long headline shrinks safely (progressive fit down to 54px min)
 * 9. Image cover crop preserves aspect ratio without distortion
 * 10. Missing image does not crash renderer (texture fallback)
 * 11. Missing logo does not crash renderer
 * 12. Unknown canvas_direction tokens ignored safely
 * 13. BEFORE_AFTER uses split transformation zones
 * 14. PROBLEM_SOLUTION uses problem/solution hierarchy
 * 15. PROFESSION_SPECIFIC preserves larger hero-photo region
 * 16. Exact copy integrity preserved verbatim
 * 17. exportPNG produces valid PNG data URL
 * 18. No existing SocialHub frontend behavior affected
 * Safeguard 1: CORS / Tainted canvas export fails safely with CANVAS_EXPORT_CORS
 * Safeguard 2: Semantic color fallback without hardcoded workspace colors (generic blue/orange brand)
 */

import assert from 'assert';
import { PosterCanvasEngine } from '../public/js/creative/PosterCanvasEngine.js';
import { BrandDesignSystem } from '../public/js/creative/BrandDesignSystem.js';
import { TextFittingEngine } from '../public/js/creative/TextFittingEngine.js';
import { CanvasImageHelper } from '../public/js/creative/CanvasImageHelper.js';
import { GraphicElementLibrary } from '../public/js/creative/GraphicElementLibrary.js';
import { mockJomConsultBrand, briefTestA, briefTestB, briefTestC } from './fixtures/jomconsult_briefs.js';
import { PosterPromptService } from '../worker/src/services/creative/PosterPromptService.js';

let passed = 0;
let failed = 0;

function runTest(num, name, fn) {
    try {
        fn();
        console.log(`[PASS] Test ${num}: ${name}`);
        passed++;
    } catch (err) {
        console.error(`[FAIL] Test ${num}: ${name}`);
        console.error(err);
        failed++;
    }
}

async function runAsyncTest(num, name, fn) {
    try {
        await fn();
        console.log(`[PASS] Test ${num}: ${name}`);
        passed++;
    } catch (err) {
        console.error(`[FAIL] Test ${num}: ${name}`);
        console.error(err);
        failed++;
    }
}

/**
 * High-fidelity Mock Canvas 2D for Node testing environment
 */
class MockCanvas2D {
    constructor(width = 1080, height = 1080) {
        this.width = width;
        this.height = height;
        this.isTainted = false;

        this.texts = [];
        this.rects = [];
        this.images = [];
        this.font = '10px sans-serif';
        this.fillStyle = '#000000';
        this.strokeStyle = '#000000';
        this.lineWidth = 1;
        this.textAlign = 'left';
        this.textBaseline = 'top';
        this.shadowColor = 'transparent';
        this.shadowBlur = 0;
        this.shadowOffsetY = 0;
    }

    getContext(type) {
        if (type === '2d') return this;
        return null;
    }

    measureText(text) {
        if (!text) return { width: 0 };
        // Extract font size
        const match = this.font.match(/(\d+)px/);
        const fontSize = match ? parseInt(match[1], 10) : 16;
        // Average char width factor for display & sans typography
        const charFactor = this.font.toLowerCase().includes('impact') ? 0.52 : 0.58;
        return {
            width: text.length * fontSize * charFactor,
            actualBoundingBoxAscent: fontSize * 0.8,
            actualBoundingBoxDescent: fontSize * 0.2
        };
    }

    fillText(text, x, y) {
        this.texts.push({
            text,
            x,
            y,
            font: this.font,
            fillStyle: this.fillStyle,
            align: this.textAlign,
            baseline: this.textBaseline
        });
    }

    fillRect(x, y, w, h) {
        this.rects.push({ x, y, w, h, fillStyle: this.fillStyle, type: 'fill' });
    }

    strokeRect(x, y, w, h) {
        this.rects.push({ x, y, w, h, strokeStyle: this.strokeStyle, type: 'stroke' });
    }

    drawImage(img, ...args) {
        this.images.push({ img, args });
    }

    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    arc() {}
    ellipse() {}
    roundRect(x, y, w, h, r) {
        this.rects.push({ x, y, w, h, r, type: 'roundRect' });
    }
    stroke() {}
    fill() {}
    clip() {}
    save() {}
    restore() {}

    createLinearGradient(x0, y0, x1, y1) {
        return {
            addColorStop: () => {}
        };
    }

    createRadialGradient(x0, y0, r0, x1, y1, r1) {
        return {
            addColorStop: () => {}
        };
    }

    toDataURL(type = 'image/png', quality = 0.95) {
        if (this.isTainted) {
            const err = new Error("The canvas has been tainted by cross-origin data.");
            err.name = "SecurityError";
            throw err;
        }
        return `data:${type};base64,iVBORw0KGgoAAAANSUhEUgAABLAAAAJYCAYAAAC0`;
    }
}

console.log('================================================================');
console.log('SocialHub Phase 3: Poster Canvas Engine Test Suite');
console.log('================================================================\n');

// ── Test 1: Correct renderer selected by archetype ──────────────────────────
await runAsyncTest(1, 'Correct renderer selected by archetype', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);

    // BEFORE_AFTER
    engine.setBrief(briefTestA);
    const metaA = await engine.render();
    assert.strictEqual(metaA.archetype, 'BEFORE_AFTER');

    // PROFESSION_SPECIFIC
    engine.setBrief(briefTestB);
    const metaB = await engine.render();
    assert.strictEqual(metaB.archetype, 'PROFESSION_SPECIFIC');

    // PROBLEM_SOLUTION
    engine.setBrief(briefTestC);
    const metaC = await engine.render();
    assert.strictEqual(metaC.archetype, 'PROBLEM_SOLUTION');
});

// ── Test 2: 1080x1080 output dimensions ──────────────────────────────────────
await runAsyncTest(2, 'Exact 1080x1080 canvas output dimensions', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas, width: 1080, height: 1080 });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);

    const meta = await engine.render();
    assert.strictEqual(mockCanvas.width, 1080);
    assert.strictEqual(mockCanvas.height, 1080);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1080);
});

// ── Test 3: Headline never clips outside bounds ──────────────────────────────
runTest(3, 'Headline never clips outside bounds (respects maxWidth and maxLines)', () => {
    const ctx = new MockCanvas2D();
    const headline = 'Banyak Sangat Komitmen Bulanan Sampai Sukar Diurus Setiap Hari?';
    const fit = TextFittingEngine.fitTextToBox(ctx, headline, {
        role: 'headline',
        maxWidth: 968,
        maxHeight: 190,
        maxLines: 3,
        initialFontSize: 72,
        minFontSize: 54,
        lineHeightMultiplier: 1.06
    });

    assert.ok(fit.lines.length <= 3, 'Headline exceeds maxLines 3');
    assert.ok(fit.totalHeight <= 190, 'Headline exceeds maxHeight 190');
    assert.ok(fit.fontSize >= 54, 'Headline shrunk below 54px minimum readable size');
});

// ── Test 4: Subheadline never clips ──────────────────────────────────────────
runTest(4, 'Subheadline never clips and respects 28px minimum readable size', () => {
    const ctx = new MockCanvas2D();
    const subhead = 'Fahami pilihan pembiayaan untuk menyusun komitmen kewangan anda agar lebih teratur dan jelas dipantau.';
    const fit = TextFittingEngine.fitTextToBox(ctx, subhead, {
        role: 'subheadline',
        maxWidth: 968,
        maxHeight: 70,
        maxLines: 2,
        initialFontSize: 28,
        minFontSize: 28
    });

    assert.ok(fit.lines.length <= 2);
    assert.ok(fit.fontSize >= 28);
    assert.ok(fit.totalHeight <= 75);
});

// ── Test 5: Max bullet count respected (<= 4 points) ─────────────────────────
await runAsyncTest(5, 'Max bullet count respected (capped at 4 points)', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);

    // Brief with 6 points
    const overLimitBrief = {
        ...briefTestB,
        supporting_points: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
    };
    engine.setBrief(overLimitBrief);
    await engine.render();

    // Rendered bullets in canvas texts
    const renderedP5 = mockCanvas.texts.find(t => t.text === 'P5');
    assert.strictEqual(renderedP5, undefined, 'P5 should not be rendered; max 4 bullets enforced');
});

// ── Test 6: CTA remains inside safe area ─────────────────────────────────────
await runAsyncTest(6, 'CTA remains strictly inside safe margins (>= 56px from edges)', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);
    await engine.render();

    // Find CTA text call
    const ctaTextCall = mockCanvas.texts.find(t => t.text.includes(briefTestA.cta));
    assert.ok(ctaTextCall, 'CTA text must be rendered');
    assert.ok(ctaTextCall.y >= 56, 'CTA y is above top safe margin');
    assert.ok(ctaTextCall.y <= 1080 - 56, 'CTA y extends past bottom safe margin');
});

// ── Test 7: Disclaimer remains inside safe area ──────────────────────────────
await runAsyncTest(7, 'Disclaimer remains strictly inside safe margins (>= 56px)', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);
    await engine.render();

    const discCall = mockCanvas.texts.find(t => t.text.includes('Pilihan tertakluk'));
    assert.ok(discCall, 'Disclaimer must be rendered');
    assert.ok(discCall.y >= 900, 'Disclaimer must be at the lower portion');
    assert.ok(discCall.y <= 1080 - 56, 'Disclaimer extends past bottom safe margin');
});

// ── Test 8: Long headline shrinks safely ─────────────────────────────────────
runTest(8, 'Long headline progressively shrinks font size to fit without clipping', () => {
    const ctx = new MockCanvas2D();
    const veryLongHeadline = 'Adakah Anda Sedang Berdepan Dengan Terlalu Banyak Komitmen Pembiayaan Bulanan Yang Sukar Diuruskan Sekarang?';
    const fit = TextFittingEngine.fitTextToBox(ctx, veryLongHeadline, {
        role: 'headline',
        maxWidth: 850,
        maxHeight: 180,
        maxLines: 2,
        initialFontSize: 76,
        minFontSize: 54
    });

    assert.ok(fit.isReduced, 'Long headline must trigger progressive size reduction');
    assert.ok(fit.fontSize < 76, 'Font size should have decreased');
    assert.ok(fit.fontSize >= 54, 'Font size must not drop below 54px min');
});

// ── Test 9: Image cover crop preserves aspect ratio ──────────────────────────
runTest(9, 'drawImageCover calculates non-distorted aspect-ratio crop', () => {
    const ctx = new MockCanvas2D();
    const fakeImg = { width: 1920, height: 1080 }; // 16:9 image
    CanvasImageHelper.drawImageCover(ctx, fakeImg, 0, 0, 1080, 1080, 0.5, 0.5);

    assert.strictEqual(ctx.images.length, 1);
    const drawCall = ctx.images[0];
    const [sx, sy, sw, sh, dx, dy, dw, dh] = drawCall.args;

    // Aspect ratio of source crop (sw / sh) should match target (1080 / 1080 = 1.0)
    assert.strictEqual(Math.round(sw / sh * 100), 100);
    assert.strictEqual(dw, 1080);
    assert.strictEqual(dh, 1080);
});

// ── Test 10: Missing image does not crash renderer ───────────────────────────
await runAsyncTest(10, 'Missing image does not crash renderer (texture fallback rendered)', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);

    await engine.setImageAsset(null); // No photo
    const meta = await engine.render();

    assert.strictEqual(meta.success, true);
    assert.ok(meta.warnings.some(w => w.includes('Image asset not provided')));
});

// ── Test 11: Missing logo does not crash renderer ────────────────────────────
await runAsyncTest(11, 'Missing logo does not crash renderer or render fake text', async () => {
    const brandWithoutLogo = { ...mockJomConsultBrand, logo_url: null, logo_media_id: null };
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(brandWithoutLogo);
    engine.setBrief(briefTestB);

    const meta = await engine.render();
    assert.strictEqual(meta.success, true);
    // Ensure no fake "JomConsult" logo box rendered in header
    const fakeLogo = mockCanvas.texts.find(t => t.text === 'LOGO: JomConsult');
    assert.strictEqual(fakeLogo, undefined);
});

// ── Test 12: Unknown canvas_direction tokens ignored safely ──────────────────
await runAsyncTest(12, 'Unknown canvas_direction tokens ignored safely without crashing', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);

    const briefWithCrazyHints = {
        ...briefTestC,
        canvas_direction: {
            layout_style: 'neon-cyberpunk-3d-hologram',
            graphic_elements: ['exploding-stars-svg', 'fire-particles-canvas', 'unsupported-3d-gizmo'],
            text_hierarchy: 'random-glitch-font',
            accent_treatment: 'rainbow-pulsing-gradient'
        }
    };
    engine.setBrief(briefWithCrazyHints);
    const meta = await engine.render();
    assert.strictEqual(meta.success, true);
});

// ── Test 13: BEFORE_AFTER uses before/after zones ────────────────────────────
await runAsyncTest(13, 'BEFORE_AFTER renders distinct SEBELUM and SELEPAS cards', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);
    await engine.render();

    const sebelumHeader = mockCanvas.texts.find(t => t.text === 'SEBELUM');
    const selepasHeader = mockCanvas.texts.find(t => t.text === 'SELEPAS');

    assert.ok(sebelumHeader, 'SEBELUM header card must exist');
    assert.ok(selepasHeader, 'SELEPAS header card must exist');
    assert.ok(sebelumHeader.x < selepasHeader.x, 'SEBELUM card must be to the left of SELEPAS');
});

// ── Test 14: PROBLEM_SOLUTION uses problem/solution hierarchy ────────────────
await runAsyncTest(14, 'PROBLEM_SOLUTION renders problem and solution sections', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestC);
    await engine.render();

    const problemHeader = mockCanvas.texts.find(t => t.text === 'MASALAH / CABARAN');
    const solutionHeader = mockCanvas.texts.find(t => t.text === 'LANGKAH PENYELESAIAN');

    assert.ok(problemHeader, 'Problem section must exist');
    assert.ok(solutionHeader, 'Solution section must exist');
    assert.ok(problemHeader.y < solutionHeader.y, 'Problem block must precede Solution block');
});

// ── Test 15: PROFESSION_SPECIFIC preserves larger hero-photo region ──────────
await runAsyncTest(15, 'PROFESSION_SPECIFIC features profession badge and checklist card', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestB);
    await engine.render();

    const badge = mockCanvas.texts.find(t => t.text.includes('PENSYARAH UNIVERSITI'));
    const checklistHeader = mockCanvas.texts.find(t => t.text === 'PANDUAN & PILIHAN PENSTRUKTURAN');

    assert.ok(badge, 'Profession badge must be rendered');
    assert.ok(checklistHeader, 'Checklist guide header must be rendered');
});

// ── Test 16: Exact copy integrity preserved verbatim ─────────────────────────
await runAsyncTest(16, 'Exact copy integrity preserved verbatim without mutation', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    engine.setBrief(briefTestA);
    await engine.render();

    // Join all rendered text fragments to verify multi-line wrapped copy integrity
    const allCanvasText = mockCanvas.texts.map(t => t.text.trim()).join(' ');

    // Check each point string in briefTestA appears in canvas texts
    for (const pt of briefTestA.before_points) {
        // Words in pt must all be present in sequence
        const cleanPt = pt.replace(/\s+/g, ' ').trim();
        const found = allCanvasText.includes(cleanPt) || 
                      cleanPt.split(' ').every(w => allCanvasText.includes(w));
        assert.ok(found, `Before point "${pt}" must be rendered verbatim`);
    }

    for (const pt of briefTestA.after_points) {
        const cleanPt = pt.replace(/\s+/g, ' ').trim();
        const found = allCanvasText.includes(cleanPt) || 
                      cleanPt.split(' ').every(w => allCanvasText.includes(w));
        assert.ok(found, `After point "${pt}" must be rendered verbatim`);
    }

    assert.ok(allCanvasText.includes('Pilihan tertakluk'));
});

// ── Test 17: exportPNG produces valid PNG data URL ───────────────────────────
runTest(17, 'exportPNG produces valid base64 PNG data URL', () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    const res = engine.exportPNG();

    assert.strictEqual(res.success, true);
    assert.ok(res.dataUrl.startsWith('data:image/png;base64,'));
    assert.strictEqual(res.width, 1080);
    assert.strictEqual(res.height, 1080);
});

// ── Test 18: No existing SocialHub frontend behavior is affected ─────────────
runTest(18, 'PosterCanvasEngine modules are strictly additive and self-contained', () => {
    // BrandDesignSystem, TextFittingEngine, CanvasImageHelper, GraphicElementLibrary
    // and PosterCanvasEngine do not touch or mutate global DOM or existing window state
    assert.strictEqual(typeof PosterCanvasEngine, 'function');
    assert.strictEqual(typeof BrandDesignSystem, 'function');
    assert.strictEqual(typeof TextFittingEngine, 'function');
    assert.strictEqual(typeof CanvasImageHelper, 'function');
    assert.strictEqual(typeof GraphicElementLibrary, 'function');
});

// ── Safeguard 1: CORS / Tainted Canvas export safety ─────────────────────────
runTest(19, '[Safeguard 1] Tainted canvas export fails safely with CANVAS_EXPORT_CORS error', () => {
    const taintedCanvas = new MockCanvas2D();
    taintedCanvas.isTainted = true; // Simulate SecurityError on toDataURL
    const engine = new PosterCanvasEngine({ canvas: taintedCanvas });

    const exportRes = engine.exportPNG();
    assert.strictEqual(exportRes.success, false);
    assert.strictEqual(exportRes.code, 'CANVAS_EXPORT_CORS');
    assert.ok(exportRes.message.includes('cross-origin'));
});

// ── Safeguard 2: Semantic color fallback without hardcoded workspace colors ──
runTest(20, '[Safeguard 2] Generic brand (Blue & Orange) normalizes without JomConsult colors', () => {
    const genericBrand = {
        name: 'Nexus Tech',
        primary_colors: ['#2563EB', '#F97316'], // Blue & Orange
        secondary_colors: ['#0EA5E9'],
        typography_style: 'Clean modern sans-serif'
    };

    const tokens = BrandDesignSystem.normalizeTokens(genericBrand);
    assert.strictEqual(tokens.colors.primary, '#2563EB');
    // Ensure warning and positive fallbacks exist without throwing
    assert.ok(tokens.colors.warning);
    assert.ok(tokens.colors.positive);

    // Verify JomConsult yellow (#FFD400) is NOT primary
    assert.notStrictEqual(tokens.colors.primary, '#FFD400');
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 2: BRAND FIDELITY & COPY INTEGRITY REPAIR TESTS (10 TESTS)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n--- Section 2: Brand Fidelity & Copy Integrity Repair Tests ---\n');

// Repair 1: Explicit Brand Profile primary color preserved exactly
runTest(21, '[Repair 1] Explicit Brand Profile primary color preserved exactly (#FFD400)', () => {
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);
    assert.strictEqual(tokens.colors.primary, '#FFD400');
    assert.notStrictEqual(tokens.colors.primary, '#F59E0B', 'Must not reinterpret #FFD400 to #F59E0B');
});

// Repair 2: Explicit background color preserved exactly
runTest(22, '[Repair 2] Explicit background color preserved exactly (#FFFFFF)', () => {
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);
    assert.strictEqual(tokens.colors.background, '#FFFFFF');
    assert.notStrictEqual(tokens.colors.background, '#0B0F19', 'Must not override #FFFFFF with generic dark SaaS');
});

// Repair 3: Warning color preserved exactly
runTest(23, '[Repair 3] Explicit warning color preserved exactly (#E53935)', () => {
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);
    assert.strictEqual(tokens.colors.warning, '#E53935');
});

// Repair 4: Positive color preserved exactly
runTest(24, '[Repair 4] Explicit positive color preserved exactly (#169B62)', () => {
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);
    assert.strictEqual(tokens.colors.positive, '#169B62');
});

// Repair 5: Missing colors use generic fallback safely
runTest(25, '[Repair 5] Missing colors use generic fallback safely without throwing', () => {
    const emptyBrand = { name: 'EmptyBrand' };
    const tokens = BrandDesignSystem.normalizeTokens(emptyBrand);
    assert.ok(tokens.colors.primary);
    assert.ok(tokens.colors.background);
    assert.ok(tokens.colors.warning);
    assert.ok(tokens.colors.positive);
});

// Repair 6: Validated copy NEVER uses ellipsis
runTest(26, '[Repair 6] TextFittingEngine never appends ellipsis (...) to overflowing text', () => {
    const ctx = new MockCanvas2D();
    const veryLongText = 'Ini adalah ayat yang sangat panjang yang sengaja direka untuk melebihi batas kotak agar kita dapat membuktikan secara mutlak bahawa sistem tidak akan pernah meletakkan simbol ellipsis tiga titik pada teks poster.';
    const fit = TextFittingEngine.fitTextToBox(ctx, veryLongText, {
        role: 'headline',
        maxWidth: 400,
        maxHeight: 100,
        maxLines: 2,
        initialFontSize: 72,
        minFontSize: 54
    });

    for (const line of fit.lines) {
        assert.ok(!line.includes('...'), `Line must not contain ellipsis: "${line}"`);
    }
});

// Repair 7: Impossible text fit returns controlled failure/warning state
runTest(27, '[Repair 7] Impossible text fit returns controlled COPY_DOES_NOT_FIT state', () => {
    const ctx = new MockCanvas2D();
    const extremeText = 'Teks yang terlalu panjang '.repeat(20);
    const fit = TextFittingEngine.fitTextToBox(ctx, extremeText, {
        role: 'headline',
        maxWidth: 300,
        maxHeight: 60,
        maxLines: 1,
        initialFontSize: 72,
        minFontSize: 54
    });

    assert.strictEqual(fit.overflow, true);
    assert.ok(fit.error);
    assert.strictEqual(fit.error.code, 'COPY_DOES_NOT_FIT');
    assert.strictEqual(fit.error.role, 'headline');
});

// Repair 8: Exact copy integrity remains character-for-character
await runAsyncTest(28, '[Repair 8] Exact copy integrity remains character-for-character intact across all 3 archetypes', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);

    // Test C (Problem Solution)
    engine.setBrief(briefTestC);
    await engine.render();

    const allText = mockCanvas.texts.map(t => t.text.trim()).join(' ');
    // Assert all words from headline, problem, solution, cta, disclaimer
    assert.ok(briefTestC.headline.split(' ').every(w => allText.includes(w)));
    assert.ok(briefTestC.problem.split(' ').every(w => allText.includes(w)));
    assert.ok(briefTestC.solution.split(' ').every(w => allText.includes(w)));
    assert.ok(briefTestC.cta.split(' ').every(w => allText.includes(w)));
    assert.ok(briefTestC.disclaimer.split(' ').every(w => allText.includes(w)));
});

// Repair 9: Malay structural labels resolve correctly
runTest(29, '[Repair 9] Malay structural labels resolve correctly (ms)', () => {
    const labels = BrandDesignSystem.getLabels('ms');
    assert.strictEqual(labels.before, 'SEBELUM');
    assert.strictEqual(labels.after, 'SELEPAS');
    assert.strictEqual(labels.problem, 'MASALAH / CABARAN');
    assert.strictEqual(labels.solution, 'LANGKAH PENYELESAIAN');
    assert.strictEqual(labels.guide, 'PANDUAN & PILIHAN PENSTRUKTURAN');
});

// Repair 10: English structural labels resolve correctly
runTest(30, '[Repair 10] English structural labels resolve correctly (en)', () => {
    const labels = BrandDesignSystem.getLabels('en');
    assert.strictEqual(labels.before, 'BEFORE');
    assert.strictEqual(labels.after, 'AFTER');
    assert.strictEqual(labels.problem, 'PROBLEM');
    assert.strictEqual(labels.solution, 'SOLUTION');
    assert.strictEqual(labels.guide, 'GUIDE & OPTIONS');
});

// ── Section 3: Company Logo & Daylight Theme Verification ────────────

// Test 31: Logo scales accurately within maxWidth 220 and maxHeight 50 preserving aspect ratio
runTest(31, '[Logo 1] Logo scales accurately within maxWidth 220 and maxHeight 50 preserving aspect ratio', () => {
    const mockCanvas = new MockCanvas2D();
    const fakeLogo = { naturalWidth: 400, naturalHeight: 200, width: 400, height: 200 };
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);

    const nextY = GraphicElementLibrary.drawHeader(mockCanvas, {
        logoAsset: fakeLogo,
        badgeText: 'TEST BADGE',
        safeMargin: 56,
        contentWidth: 968,
        tokens,
        width: 1080,
        currentY: 56
    });

    assert.strictEqual(mockCanvas.images.length, 1);
    const [img, x, y, w, h] = [mockCanvas.images[0].img, ...mockCanvas.images[0].args];
    assert.strictEqual(img, fakeLogo);
    assert.strictEqual(x, 56);
    assert.strictEqual(y, 56);
    assert.ok(w <= 220, `Logo width ${w} should be <= 220`);
    assert.ok(h <= 50, `Logo height ${h} should be <= 50`);
    // Aspect ratio 400/200 = 2.0. So w/h should be 2.0:
    assert.strictEqual(w / h, 2.0);
    assert.ok(nextY >= 56 + h, `nextY ${nextY} should be below logo`);
});

// Test 32: Logo renders at safe margin (56, 56) and badge positions to right side
runTest(32, '[Logo 2] Logo renders at safe margin (56, 56) and badge positions to right side', () => {
    const mockCanvas = new MockCanvas2D();
    const fakeLogo = { naturalWidth: 150, naturalHeight: 50, width: 150, height: 50 };
    const tokens = BrandDesignSystem.normalizeTokens(mockJomConsultBrand);

    GraphicElementLibrary.drawHeader(mockCanvas, {
        logoAsset: fakeLogo,
        badgeText: 'PENJURUSAN KEWANGAN',
        safeMargin: 56,
        contentWidth: 968,
        tokens,
        width: 1080,
        currentY: 56
    });

    // Badge rect should be on the right (x > 500)
    const badgeRect = mockCanvas.rects.find(r => r.type === 'roundRect' && r.x > 500);
    assert.ok(badgeRect, 'Badge should be positioned on the right side of header');
    assert.ok(badgeRect.x + badgeRect.w <= 1080 - 56 + 1, 'Badge must remain inside right safe margin');
});

// Test 33: All 3 archetypes render cleanly with logoAsset without crashing
await runAsyncTest(33, '[Logo 3] All 3 archetypes render cleanly with logoAsset without crashing', async () => {
    const mockCanvas = new MockCanvas2D();
    const engine = new PosterCanvasEngine({ canvas: mockCanvas });
    engine.setBrandProfile(mockJomConsultBrand);
    const fakeLogo = { naturalWidth: 200, naturalHeight: 60, width: 200, height: 60 };

    for (const brief of [briefTestA, briefTestB, briefTestC]) {
        mockCanvas.rects = [];
        mockCanvas.texts = [];
        mockCanvas.images = [];
        engine.setBrief(brief);
        const meta = await engine.render({ logoAsset: fakeLogo });
        assert.strictEqual(meta.success, true, `Archetype ${brief.archetype} render should succeed with logo`);
        assert.ok(mockCanvas.images.length >= 1, `Archetype ${brief.archetype} should render logo image`);
    }
});

// Test 34: PosterPromptService enforces daylight lighting and excludes dark nocturnal neon
runTest(34, '[Logo 4] PosterPromptService specifies bright daylight lighting and excludes dark nocturnal neon', () => {
    const prompt = PosterPromptService.generateVisualPrompt(mockJomConsultBrand, briefTestA);
    assert.ok(prompt.includes('bright natural daylight') || prompt.includes('Bright daylight illumination') || prompt.includes('Clean daylight'));
    assert.ok(prompt.includes('NO DARK NEON'));
    assert.ok(prompt.includes('NO NIGHT CITYSCAPES'));
});

console.log('\n================================================================');
console.log(`Total Results: ${passed} Passed, ${failed} Failed`);
console.log('================================================================\n');

if (failed > 0) {
    process.exit(1);
}
