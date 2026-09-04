/**
 * PosterCanvasEngine.js
 * Central client-side orchestrator for deterministic 1080x1080 poster canvas rendering.
 *
 * Coordinates:
 * - Brand design token normalization
 * - Image asset loading & CORS handling
 * - Archetype renderer dispatching (BEFORE_AFTER, PROBLEM_SOLUTION, PROFESSION_SPECIFIC)
 * - Safe PNG export with CORS taint detection (Safeguard 1)
 * - Render metrics & warnings collection
 */

import { BrandDesignSystem } from './BrandDesignSystem.js';
import { CanvasImageHelper } from './CanvasImageHelper.js';
import { BeforeAfterRenderer } from './renderers/BeforeAfterRenderer.js';
import { ProblemSolutionRenderer } from './renderers/ProblemSolutionRenderer.js';
import { ProfessionSpecificRenderer } from './renderers/ProfessionSpecificRenderer.js';

export class PosterCanvasEngine {
    constructor(options = {}) {
        this.width = options.width || 1080;
        this.height = options.height || 1080;

        if (options.canvas) {
            this.canvas = options.canvas;
        } else if (typeof document !== 'undefined') {
            this.canvas = document.createElement('canvas');
        } else {
            // Node/mock environment
            this.canvas = {
                width: this.width,
                height: this.height,
                getContext: () => null
            };
        }

        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');

        this.brief = null;
        this.brandProfile = null;
        this.tokens = BrandDesignSystem.normalizeTokens({});
        this.imageAsset = null;
        this.logoAsset = null;
        this.lastMetadata = null;
    }

    /**
     * Set validated Creative Brief
     */
    setBrief(brief) {
        if (!brief || typeof brief !== 'object') {
            throw new Error('Brief must be a valid Creative Brief JSON object.');
        }
        this.brief = brief;
        return this;
    }

    /**
     * Set Brand Profile and re-normalize design tokens
     */
    setBrandProfile(brandProfile) {
        this.brandProfile = brandProfile || {};
        this.tokens = BrandDesignSystem.normalizeTokens(this.brandProfile);
        return this;
    }

    /**
     * Set or load photographic image asset (supports URL, data URL, Image object)
     */
    async setImageAsset(source) {
        if (!source) {
            this.imageAsset = null;
            return this;
        }

        try {
            this.imageAsset = await CanvasImageHelper.loadImage(source);
        } catch (err) {
            console.warn('[PosterCanvasEngine] Failed to load image asset, proceeding with fallback background:', err.message);
            this.imageAsset = null;
        }
        return this;
    }

    /**
     * Set or load brand logo asset (supports URL, data URL, Image object)
     */
    async setLogoAsset(source) {
        if (!source) {
            this.logoAsset = null;
            return this;
        }

        try {
            this.logoAsset = await CanvasImageHelper.loadImage(source);
        } catch (err) {
            console.warn('[PosterCanvasEngine] Failed to load logo asset, proceeding without logo:', err.message);
            this.logoAsset = null;
        }
        return this;
    }

    /**
     * Render the poster deterministically onto the canvas
     */
    async render(options = {}) {
        const startTime = Date.now();

        if (options.brief) this.setBrief(options.brief);
        if (options.brandProfile) this.setBrandProfile(options.brandProfile);
        if (options.imageAsset !== undefined) await this.setImageAsset(options.imageAsset);
        if (options.logoAsset !== undefined) {
            await this.setLogoAsset(options.logoAsset);
        } else if (!this.logoAsset && (this.tokens?.logoUrl || this.brandProfile?.logo_url)) {
            await this.setLogoAsset(this.tokens?.logoUrl || this.brandProfile?.logo_url);
        }

        if (!this.brief) {
            throw new Error('Cannot render: Creative Brief not set. Call setBrief() first.');
        }

        // Ensure canvas dimensions
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        const archetype = (this.brief.archetype || 'PROBLEM_SOLUTION').toUpperCase();
        let renderResult = { warnings: [], metrics: {} };

        const renderParams = {
            ctx: this.ctx,
            width: this.width,
            height: this.height,
            brief: this.brief,
            brand: this.brandProfile || {},
            tokens: this.tokens,
            imageAsset: this.imageAsset,
            logoAsset: this.logoAsset
        };

        // Dispatch to appropriate archetype renderer
        switch (archetype) {
            case 'BEFORE_AFTER':
                renderResult = BeforeAfterRenderer.render(renderParams);
                break;
            case 'PROFESSION_SPECIFIC':
                renderResult = ProfessionSpecificRenderer.render(renderParams);
                break;
            case 'PROBLEM_SOLUTION':
            default:
                renderResult = ProblemSolutionRenderer.render(renderParams);
                break;
        }

        const durationMs = Date.now() - startTime;

        this.lastMetadata = {
            success: renderResult?.success !== false,
            code: renderResult?.code || (renderResult?.success === false ? 'RENDER_FAILED' : null),
            field: renderResult?.field || null,
            width: this.width,
            height: this.height,
            archetype,
            warnings: renderResult?.warnings || [],
            metrics: renderResult?.metrics || {},
            renderDurationMs: durationMs,
            brandName: this.tokens.brandName
        };

        return this.lastMetadata;
    }

    /**
     * Shorthand re-render
     */
    async rerender() {
        return this.render();
    }

    /**
     * Export Canvas as PNG data URL with strict CORS taint protection (Safeguard 1)
     */
    exportPNG(quality = 0.95) {
        if (!this.canvas || typeof this.canvas.toDataURL !== 'function') {
            return {
                success: false,
                code: 'CANVAS_NOT_SUPPORTED',
                message: 'HTML5 Canvas toDataURL is not supported in this environment.'
            };
        }

        try {
            const dataUrl = this.canvas.toDataURL('image/png', quality);
            return {
                success: true,
                dataUrl,
                width: this.width,
                height: this.height,
                byteEstimate: Math.round(dataUrl.length * 0.75)
            };
        } catch (err) {
            // Check for CORS SecurityError / Tainted canvas
            const isCorsError = err.name === 'SecurityError' || 
                                (err.message && err.message.toLowerCase().includes('taint')) ||
                                (err.message && err.message.toLowerCase().includes('cross-origin'));

            if (isCorsError) {
                return {
                    success: false,
                    code: 'CANVAS_EXPORT_CORS',
                    message: 'Image source does not allow safe Canvas export. Remote asset violates cross-origin policies.'
                };
            }

            return {
                success: false,
                code: 'CANVAS_EXPORT_FAILED',
                message: err.message || 'Failed to export canvas to PNG.'
            };
        }
    }

    /**
     * Return active canvas element
     */
    getCanvas() {
        return this.canvas;
    }

    /**
     * Return last render metadata
     */
    getMetadata() {
        return this.lastMetadata;
    }
}
